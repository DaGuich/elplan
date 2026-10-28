from collections.abc import Iterator
from typing import Any

from app.storage.base import StorageAdapter, StorageError, StorageNotFound


class S3Storage(StorageAdapter):
    """S3 API adapter (AWS S3, MinIO, Ceph). Pass `client` to inject a boto3-compatible client."""

    name = "s3"

    def __init__(
        self,
        bucket: str,
        prefix: str = "",
        client: Any = None,
        *,
        endpoint_url: str | None = None,
        region: str | None = None,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        addressing_style: str = "auto",
    ):
        if not bucket:
            raise StorageError("S3_BUCKET is required for the s3 storage backend")
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        if client is None:
            import boto3
            from botocore.config import Config

            client = boto3.client(
                "s3",
                endpoint_url=endpoint_url or None,
                region_name=region or None,
                aws_access_key_id=access_key_id or None,
                aws_secret_access_key=secret_access_key or None,
                config=Config(s3={"addressing_style": addressing_style}),
            )
        self.client = client

    def _key(self, key: str) -> str:
        return f"{self.prefix}/{key}" if self.prefix else key

    @staticmethod
    def _is_missing(exc: Exception) -> bool:
        error = getattr(exc, "response", {}).get("Error", {})
        return error.get("Code") in {"NoSuchKey", "404", "NotFound"}

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(
            Bucket=self.bucket, Key=self._key(key), Body=data, ContentType=content_type
        )

    def stream(self, key: str, chunk_size: int = 64 * 1024) -> Iterator[bytes]:
        try:
            body = self.client.get_object(Bucket=self.bucket, Key=self._key(key))["Body"]
        except Exception as exc:
            if self._is_missing(exc):
                raise StorageNotFound(key) from exc
            raise

        def chunks() -> Iterator[bytes]:
            try:
                yield from body.iter_chunks(chunk_size)
            finally:
                body.close()

        return chunks()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self._key(key))

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=self._key(key))
        except Exception as exc:
            if self._is_missing(exc):
                return False
            raise
        return True

    def presigned_url(self, key: str, filename: str, content_type: str, expires: int) -> str | None:
        safe_name = filename.replace('"', "").replace("\\", "")
        return self.client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self.bucket,
                "Key": self._key(key),
                "ResponseContentType": content_type,
                "ResponseContentDisposition": f'attachment; filename="{safe_name}"',
            },
            ExpiresIn=expires,
        )
