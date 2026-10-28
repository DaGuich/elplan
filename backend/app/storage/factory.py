from functools import lru_cache

from app.core.config import settings
from app.storage.base import StorageAdapter, StorageError
from app.storage.filesystem import FilesystemStorage
from app.storage.s3 import S3Storage


@lru_cache
def get_storage() -> StorageAdapter:
    backend = settings.STORAGE_BACKEND.lower()
    if backend == "filesystem":
        return FilesystemStorage(settings.STORAGE_LOCAL_ROOT)
    if backend == "s3":
        return S3Storage(
            settings.S3_BUCKET,
            settings.S3_PREFIX,
            endpoint_url=settings.S3_ENDPOINT_URL,
            region=settings.S3_REGION,
            access_key_id=settings.S3_ACCESS_KEY_ID,
            secret_access_key=settings.S3_SECRET_ACCESS_KEY,
            addressing_style=settings.S3_ADDRESSING_STYLE,
        )
    raise StorageError(f"Unknown STORAGE_BACKEND '{settings.STORAGE_BACKEND}'")
