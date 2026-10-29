from abc import ABC, abstractmethod
from collections.abc import Iterator


class StorageError(Exception):
    pass


class StorageNotFound(StorageError):
    pass


class StorageAdapter(ABC):
    """Unified persistence layer for blueprints, vector files and exported artifacts.

    Keys are generated server-side, relative, `/`-separated and never contain user input.
    """

    name: str

    @abstractmethod
    def put(self, key: str, data: bytes, content_type: str) -> None: ...

    @abstractmethod
    def stream(self, key: str, chunk_size: int = 64 * 1024) -> Iterator[bytes]:
        """Raises StorageNotFound when the object does not exist."""

    @abstractmethod
    def delete(self, key: str) -> None:
        """Idempotent."""

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    def presigned_url(self, key: str, filename: str, content_type: str, expires: int) -> str | None:
        """Direct download URL, or None when the backend cannot offer one."""
        return None
