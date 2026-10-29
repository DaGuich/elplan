import os
import uuid
from collections.abc import Iterator
from pathlib import Path

from app.storage.base import StorageAdapter, StorageError, StorageNotFound


class FilesystemStorage(StorageAdapter):
    name = "filesystem"

    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if path == self.root or self.root not in path.parents:
            raise StorageError("Invalid storage key")
        return path

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with open(tmp, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)

    def stream(self, key: str, chunk_size: int = 64 * 1024) -> Iterator[bytes]:
        path = self._path(key)
        try:
            handle = open(path, "rb")
        except FileNotFoundError as exc:
            raise StorageNotFound(key) from exc

        def chunks() -> Iterator[bytes]:
            with handle:
                while chunk := handle.read(chunk_size):
                    yield chunk

        return chunks()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()
