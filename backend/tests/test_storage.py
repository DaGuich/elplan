"""Storage adapter unit tests; no database required."""

import io

import pytest
from app.storage import StorageNotFound
from app.storage.base import StorageError
from app.storage.filesystem import FilesystemStorage
from app.storage.s3 import S3Storage


class FakeClientError(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}


class FakeBody(io.BytesIO):
    def iter_chunks(self, size):
        while chunk := self.read(size):
            yield chunk


class FakeS3Client:
    def __init__(self):
        self.objects = {}

    def put_object(self, Bucket, Key, Body, ContentType):
        self.objects[(Bucket, Key)] = (Body, ContentType)

    def get_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise FakeClientError("NoSuchKey")
        return {"Body": FakeBody(self.objects[(Bucket, Key)][0])}

    def head_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise FakeClientError("404")

    def delete_object(self, Bucket, Key):
        self.objects.pop((Bucket, Key), None)

    def generate_presigned_url(self, op, Params, ExpiresIn):
        return f"https://s3.example/{Params['Bucket']}/{Params['Key']}?exp={ExpiresIn}"


def roundtrip(storage):
    storage.put("blueprints/1/2/a.png", b"abc" * 50_000, "image/png")
    assert storage.exists("blueprints/1/2/a.png")
    assert b"".join(storage.stream("blueprints/1/2/a.png", 1000)) == b"abc" * 50_000
    storage.put("blueprints/1/2/a.png", b"new", "image/png")
    assert b"".join(storage.stream("blueprints/1/2/a.png")) == b"new"
    storage.delete("blueprints/1/2/a.png")
    storage.delete("blueprints/1/2/a.png")
    assert not storage.exists("blueprints/1/2/a.png")
    with pytest.raises(StorageNotFound):
        storage.stream("blueprints/1/2/a.png")


def test_filesystem_roundtrip_and_no_temp_leftovers(tmp_path):
    storage = FilesystemStorage(tmp_path)
    roundtrip(storage)
    storage.put("x/y.bin", b"1", "application/octet-stream")
    assert [p.name for p in (tmp_path / "x").iterdir()] == ["y.bin"]


@pytest.mark.parametrize("key", ["../escape", "a/../../escape", "/etc/passwd", ""])
def test_filesystem_rejects_traversal(tmp_path, key):
    with pytest.raises(StorageError):
        FilesystemStorage(tmp_path / "root").put(key, b"x", "image/png")
    assert not (tmp_path / "escape").exists()


def test_s3_roundtrip_prefix_and_presign():
    client = FakeS3Client()
    storage = S3Storage("bucket", "/uploads/", client=client)
    roundtrip(storage)
    storage.put("k.png", b"x", "image/png")
    assert ("bucket", "uploads/k.png") in client.objects
    url = storage.presigned_url("k.png", 'a"b.png', "image/png", 60)
    assert url == "https://s3.example/bucket/uploads/k.png?exp=60"


def test_s3_requires_bucket():
    with pytest.raises(StorageError):
        S3Storage("", client=FakeS3Client())
