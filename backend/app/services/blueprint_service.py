import base64
import binascii
import hashlib
import logging
import re
import uuid

from fastapi import HTTPException, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.project import BlueprintAsset, Floor, Project
from app.schemas.blueprint import (
    BlueprintCalibration,
    BlueprintCalibrationUpdate,
    BlueprintExport,
)
from app.services.project_service import _get_floor
from app.storage import StorageAdapter, StorageNotFound, get_storage

logger = logging.getLogger(__name__)

# Content types are sniffed from the bytes; the client-supplied header is ignored.
EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "image/svg+xml": ".svg",
}


def sniff_content_type(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    head = data[:2048].lstrip(b"\xef\xbb\xbf \t\r\n")
    if head.startswith((b"<?xml", b"<svg")) and b"<svg" in data[:4096]:
        return "image/svg+xml"
    return None


def _safe_filename(name: str | None, content_type: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", (name or "").replace("\\", "/").split("/")[-1]).strip(
        "._"
    )
    return (base or "blueprint" + EXTENSIONS[content_type])[:255]


async def read_upload(file: UploadFile) -> bytes:
    limit = settings.STORAGE_MAX_UPLOAD_BYTES
    data = bytearray()
    while chunk := await file.read(64 * 1024):
        data += chunk
        if len(data) > limit:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File too large")
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Empty file")
    return bytes(data)


def get_blueprint(db: Session, project: Project, floor_id: int) -> BlueprintAsset:
    floor = _get_floor(db, project, floor_id)
    asset = db.scalar(select(BlueprintAsset).where(BlueprintAsset.floor_id == floor.id))
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Blueprint not found")
    return asset


def _store(floor: Floor, data: bytes, filename: str | None, storage: StorageAdapter) -> dict:
    content_type = sniff_content_type(data)
    if content_type is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "Unsupported file type (PNG, JPEG, WebP, PDF or SVG required)",
        )
    key = f"blueprints/{floor.building.project_id}/{floor.id}/{uuid.uuid4().hex}{EXTENSIONS[content_type]}"
    try:
        storage.put(key, data, content_type)
    except Exception as exc:
        logger.exception("Blueprint storage write failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Storage backend unavailable") from exc
    return {
        "storage_backend": storage.name,
        "storage_key": key,
        "filename": _safe_filename(filename, content_type),
        "content_type": content_type,
        "size_bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def _discard(backend: str, key: str) -> None:
    try:
        get_storage_for(backend).delete(key)
    except Exception:
        logger.exception("Could not delete stored object %s", key)


def get_storage_for(backend: str) -> StorageAdapter:
    storage = get_storage()
    if storage.name != backend:
        raise RuntimeError(f"Asset stored in '{backend}' but '{storage.name}' is configured")
    return storage


def new_asset(
    floor: Floor, data: bytes, filename: str | None, calibration: BlueprintCalibration
) -> BlueprintAsset:
    """Stores the file and returns an unsaved asset row; the caller owns commit and cleanup."""
    return BlueprintAsset(
        floor_id=floor.id,
        version=1,
        **_store(floor, data, filename, get_storage()),
        **calibration.model_dump(),
    )


def read_asset_bytes(asset: BlueprintAsset) -> bytes:
    try:
        return b"".join(get_storage_for(asset.storage_backend).stream(asset.storage_key))
    except StorageNotFound as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Blueprint file missing from storage"
        ) from exc


def copy_blueprint(db: Session, source: Floor, target: Floor) -> BlueprintAsset | None:
    """Duplicate the stored file and metadata of `source` onto `target` (not committed)."""
    asset = db.scalar(select(BlueprintAsset).where(BlueprintAsset.floor_id == source.id))
    if asset is None:
        return None
    copy = new_asset(
        target,
        read_asset_bytes(asset),
        asset.filename,
        BlueprintCalibration(
            scale_mm_per_pixel=asset.scale_mm_per_pixel,
            origin_x=asset.origin_x,
            origin_y=asset.origin_y,
            rotation_deg=asset.rotation_deg,
            crop=tuple(asset.crop) if asset.crop else None,
            pdf_page=asset.pdf_page,
        ),
    )
    db.add(copy)
    return copy


def export_blueprint(db: Session, floor: Floor) -> dict | None:
    asset = db.scalar(select(BlueprintAsset).where(BlueprintAsset.floor_id == floor.id))
    if asset is None:
        return None
    return {
        "filename": asset.filename,
        "content_base64": base64.b64encode(read_asset_bytes(asset)).decode("ascii"),
        "scale_mm_per_pixel": asset.scale_mm_per_pixel,
        "origin_x": asset.origin_x,
        "origin_y": asset.origin_y,
        "rotation_deg": asset.rotation_deg,
        "crop": asset.crop,
        "pdf_page": asset.pdf_page,
    }


def import_blueprint(db: Session, floor: Floor, data: BlueprintExport) -> BlueprintAsset:
    try:
        content = base64.b64decode(data.content_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid blueprint content"
        ) from exc
    if not content or len(content) > settings.STORAGE_MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Blueprint empty or too large")
    asset = new_asset(
        floor,
        content,
        data.filename,
        BlueprintCalibration(**data.model_dump(exclude={"filename", "content_base64"})),
    )
    db.add(asset)
    return asset


def create_blueprint(
    db: Session,
    project: Project,
    floor_id: int,
    data: bytes,
    filename: str | None,
    calibration: BlueprintCalibration,
) -> BlueprintAsset:
    floor = _get_floor(db, project, floor_id)
    if db.scalar(select(BlueprintAsset.id).where(BlueprintAsset.floor_id == floor.id)) is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Floor already has a blueprint; use PUT to replace",
        )
    asset = new_asset(floor, data, filename, calibration)
    fields = {
        "storage_backend": asset.storage_backend,
        "storage_key": asset.storage_key,
    }
    db.add(asset)
    try:
        db.commit()
    except Exception:
        db.rollback()
        _discard(fields["storage_backend"], fields["storage_key"])
        raise
    db.refresh(asset)
    return asset


def replace_blueprint(
    db: Session, project: Project, floor_id: int, data: bytes, filename: str | None
) -> BlueprintAsset:
    """Swap the file only; calibration fields and floor plan_data stay untouched."""
    asset = get_blueprint(db, project, floor_id)
    floor = _get_floor(db, project, floor_id)
    old = (asset.storage_backend, asset.storage_key)
    fields = _store(floor, data, filename, get_storage())
    for name, value in fields.items():
        setattr(asset, name, value)
    asset.version += 1
    try:
        db.commit()
    except Exception:
        db.rollback()
        _discard(fields["storage_backend"], fields["storage_key"])
        raise
    _discard(*old)
    db.refresh(asset)
    return asset


def update_calibration(
    db: Session, project: Project, floor_id: int, data: BlueprintCalibrationUpdate
) -> BlueprintAsset:
    asset = get_blueprint(db, project, floor_id)
    fields = data.model_dump(exclude_unset=True)
    for name in ("origin_x", "origin_y", "rotation_deg", "pdf_page"):
        if name in fields and fields[name] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{name} cannot be null")
    if fields.get("crop") is not None:
        try:
            BlueprintCalibration(crop=fields["crop"])
        except ValidationError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid crop") from exc
    for name, value in fields.items():
        setattr(asset, name, value)
    db.commit()
    db.refresh(asset)
    return asset


def delete_blueprint(db: Session, project: Project, floor_id: int) -> None:
    asset = get_blueprint(db, project, floor_id)
    old = (asset.storage_backend, asset.storage_key)
    db.delete(asset)
    db.commit()
    _discard(*old)
