from urllib.parse import quote

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.project import BlueprintAsset
from app.models.user import User
from app.schemas.blueprint import (
    BlueprintCalibration,
    BlueprintCalibrationUpdate,
    BlueprintRead,
)
from app.services.access import require_project_access
from app.services.blueprint_service import (
    create_blueprint,
    delete_blueprint,
    get_blueprint,
    get_storage_for,
    read_upload,
    replace_blueprint,
    update_calibration,
)
from app.services.project_service import read_shared_blueprint
from app.storage import StorageNotFound

router = APIRouter(prefix="/projects/{project_id}/floors/{floor_id}/blueprint", tags=["blueprints"])
shared_router = APIRouter(prefix="/projects/shared", tags=["blueprints"])


def _calibration_form(
    scale_mm_per_pixel: float | None = Form(default=None),
    origin_x: float = Form(default=0),
    origin_y: float = Form(default=0),
    rotation_deg: float = Form(default=0),
    crop: str | None = Form(default=None, description="left,top,width,height"),
    pdf_page: int = Form(default=1),
) -> BlueprintCalibration:
    try:
        crop_values = tuple(float(v) for v in crop.split(",")) if crop else None
        return BlueprintCalibration(
            scale_mm_per_pixel=scale_mm_per_pixel,
            origin_x=origin_x,
            origin_y=origin_y,
            rotation_deg=rotation_deg,
            crop=crop_values,
            pdf_page=pdf_page,
        )
    except (ValueError, ValidationError) as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"Invalid calibration: {exc}"
        ) from exc


@router.post("", response_model=BlueprintRead, status_code=status.HTTP_201_CREATED)
async def post_blueprint(
    project_id: int,
    floor_id: int,
    file: UploadFile = File(),
    calibration: BlueprintCalibration = Depends(_calibration_form),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    data = await read_upload(file)
    return await run_in_threadpool(
        create_blueprint, db, project, floor_id, data, file.filename, calibration
    )


@router.put("", response_model=BlueprintRead)
async def put_blueprint(
    project_id: int,
    floor_id: int,
    file: UploadFile = File(),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    data = await read_upload(file)
    return await run_in_threadpool(replace_blueprint, db, project, floor_id, data, file.filename)


@router.get("", response_model=BlueprintRead)
def get_blueprint_metadata(
    project_id: int,
    floor_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_blueprint(db, require_project_access(db, project_id, user), floor_id)


@router.patch("/calibration", response_model=BlueprintRead)
def patch_blueprint_calibration(
    project_id: int,
    floor_id: int,
    payload: BlueprintCalibrationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return update_calibration(db, require_project_access(db, project_id, user), floor_id, payload)


def _content_response(asset: BlueprintAsset) -> Response:
    storage = get_storage_for(asset.storage_backend)
    if settings.S3_PRESIGN_DOWNLOADS:
        url = storage.presigned_url(
            asset.storage_key,
            asset.filename,
            asset.content_type,
            settings.S3_PRESIGN_EXPIRES_SECONDS,
        )
        if url:
            return RedirectResponse(url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
    try:
        chunks = storage.stream(asset.storage_key)
    except StorageNotFound as exc:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Blueprint file missing from storage"
        ) from exc
    return StreamingResponse(
        chunks,
        media_type=asset.content_type,
        headers={
            # attachment + sandbox CSP keep uploaded SVG/PDF from executing in the app origin
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(asset.filename)}",
            "Content-Security-Policy": "sandbox; default-src 'none'",
            "X-Content-Type-Options": "nosniff",
            "ETag": f'"{asset.sha256}"',
            "Content-Length": str(asset.size_bytes),
        },
    )


@router.get("/content")
def get_blueprint_content(
    project_id: int,
    floor_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _content_response(
        get_blueprint(db, require_project_access(db, project_id, user), floor_id)
    )


@shared_router.get("/{token}/floors/{floor_id}/blueprint/content")
def get_shared_blueprint_content(
    token: str,
    floor_id: int,
    password: str | None = Header(default=None, alias="X-Share-Password"),
    db: Session = Depends(get_db),
):
    return _content_response(read_shared_blueprint(db, token, password, floor_id))


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def remove_blueprint(
    project_id: int,
    floor_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    delete_blueprint(db, require_project_access(db, project_id, user), floor_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
