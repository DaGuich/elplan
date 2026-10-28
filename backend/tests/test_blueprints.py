"""Integration tests; require DATABASE_URL pointing at a migrated database."""

import pytest
from app.core.config import settings
from app.core.db import SessionLocal
from app.main import app
from app.models.project import Floor
from app.storage import get_storage
from fastapi.testclient import TestClient
from tests.test_access import make_user

client = TestClient(app)
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PNG2 = b"\x89PNG\r\n\x1a\n" + b"\x01" * 128
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32


@pytest.fixture()
def storage_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "STORAGE_BACKEND", "filesystem")
    monkeypatch.setattr(settings, "STORAGE_LOCAL_ROOT", str(tmp_path))
    get_storage.cache_clear()
    yield tmp_path
    get_storage.cache_clear()


@pytest.fixture()
def floor_ctx(storage_root):
    alice, eve = make_user("alice"), make_user("eve")
    org = client.post("/api/v1/organizations", json={"name": "Acme"}, headers=alice["h"]).json()
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "P"},
        headers=alice["h"],
    ).json()
    building = client.post(
        f"/api/v1/projects/{project['id']}/buildings",
        json={"name": "B", "floors": [{"name": "F"}]},
        headers=alice["h"],
    ).json()
    floor_id = building["floors"][0]["id"]
    base = f"/api/v1/projects/{project['id']}/floors/{floor_id}"
    return alice, eve, base, floor_id, project


def stored_files(root):
    return sorted(p for p in root.rglob("*") if p.is_file())


def test_upload_download_and_access(floor_ctx, storage_root):
    alice, eve, base, _, _ = floor_ctx
    r = client.post(
        f"{base}/blueprint",
        files={"file": ("../my plan.png", PNG, "application/octet-stream")},
        data={
            "scale_mm_per_pixel": "12.5",
            "origin_x": "3",
            "rotation_deg": "90",
            "crop": "1,2,30,40",
        },
        headers=alice["h"],
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["content_type"] == "image/png" and body["version"] == 1
    assert body["filename"] == "my_plan.png"
    assert body["scale_mm_per_pixel"] == 12.5 and body["crop"] == [1, 2, 30, 40]
    assert len(stored_files(storage_root)) == 1

    content = client.get(f"{base}/blueprint/content", headers=alice["h"])
    assert content.content == PNG
    assert content.headers["x-content-type-options"] == "nosniff"
    assert "attachment" in content.headers["content-disposition"]

    assert (
        client.post(
            f"{base}/blueprint", files={"file": ("a.png", PNG)}, headers=alice["h"]
        ).status_code
        == 409
    )
    for method in ("GET", "DELETE"):
        assert client.request(method, f"{base}/blueprint", headers=eve["h"]).status_code == 404
    assert client.get(f"{base}/blueprint/content", headers=eve["h"]).status_code == 404
    assert client.get(f"{base}/blueprint").status_code == 401


def test_rejects_bad_uploads(floor_ctx, storage_root, monkeypatch):
    alice, _, base, _, _ = floor_ctx
    url = f"{base}/blueprint"
    assert (
        client.post(url, files={"file": ("a.png", b"not an image")}, headers=alice["h"]).status_code
        == 415
    )
    assert client.post(url, files={"file": ("a.png", b"")}, headers=alice["h"]).status_code == 422
    bad = client.post(
        url,
        files={"file": ("a.png", PNG)},
        data={"scale_mm_per_pixel": "-1"},
        headers=alice["h"],
    )
    assert bad.status_code == 422
    monkeypatch.setattr(settings, "STORAGE_MAX_UPLOAD_BYTES", 10)
    assert client.post(url, files={"file": ("a.png", PNG)}, headers=alice["h"]).status_code == 413
    assert stored_files(storage_root) == []


def test_replace_preserves_calibration_and_plan_data(floor_ctx, storage_root):
    alice, _, base, floor_id, _ = floor_ctx
    plan = {
        "background_rotation": 15,
        "scale_m_per_100_units": 2.5,
        "rooms": [
            {
                "id": "r1",
                "name": "Kitchen",
                "x": 10,
                "y": 20,
                "width": 100,
                "height": 80,
            }
        ],
    }
    put_plan = client.put(f"{base}/plan", json=plan, headers=alice["h"])
    assert put_plan.status_code == 200, put_plan.text
    client.post(
        f"{base}/blueprint",
        files={"file": ("a.png", PNG)},
        data={
            "scale_mm_per_pixel": "5",
            "origin_x": "7",
            "origin_y": "8",
            "rotation_deg": "30",
        },
        headers=alice["h"],
    )
    with SessionLocal() as db:
        before = db.get(Floor, floor_id).plan_data

    r = client.put(f"{base}/blueprint", files={"file": ("b.jpg", JPEG)}, headers=alice["h"])
    assert r.status_code == 200, r.text
    after = r.json()
    assert after["version"] == 2 and after["content_type"] == "image/jpeg"
    assert (
        after["scale_mm_per_pixel"],
        after["origin_x"],
        after["origin_y"],
        after["rotation_deg"],
    ) == (5, 7, 8, 30)
    with SessionLocal() as db:
        assert db.get(Floor, floor_id).plan_data == before
    assert client.get(f"{base}/plan", headers=alice["h"]).json()["rooms"][0]["name"] == "Kitchen"
    assert client.get(f"{base}/blueprint/content", headers=alice["h"]).content == JPEG
    assert len(stored_files(storage_root)) == 1

    assert (
        client.put(
            f"{base}/blueprint", files={"file": ("c.png", b"junk")}, headers=alice["h"]
        ).status_code
        == 415
    )
    assert client.get(f"{base}/blueprint", headers=alice["h"]).json()["version"] == 2
    assert client.get(f"{base}/blueprint/content", headers=alice["h"]).content == JPEG


def test_replace_without_existing_is_404(floor_ctx):
    alice, _, base, _, _ = floor_ctx
    assert (
        client.put(
            f"{base}/blueprint", files={"file": ("a.png", PNG)}, headers=alice["h"]
        ).status_code
        == 404
    )


def test_calibration_patch_is_partial(floor_ctx):
    alice, _, base, _, _ = floor_ctx
    client.post(
        f"{base}/blueprint",
        files={"file": ("a.png", PNG)},
        data={"origin_x": "4"},
        headers=alice["h"],
    )
    r = client.patch(
        f"{base}/blueprint/calibration",
        json={"scale_mm_per_pixel": 2, "crop": [0, 0, 10, 10]},
        headers=alice["h"],
    )
    assert r.status_code == 200, r.text
    assert r.json()["origin_x"] == 4 and r.json()["scale_mm_per_pixel"] == 2
    bad = client.patch(
        f"{base}/blueprint/calibration",
        json={"crop": [0, 0, 0, 10]},
        headers=alice["h"],
    )
    assert bad.status_code == 422
    assert (
        client.patch(
            f"{base}/blueprint/calibration", json={"origin_x": None}, headers=alice["h"]
        ).status_code
        == 422
    )


def test_delete_and_cascade_remove_files(floor_ctx, storage_root):
    alice, _, base, _, project = floor_ctx
    client.post(f"{base}/blueprint", files={"file": ("a.png", PNG)}, headers=alice["h"])
    assert client.delete(f"{base}/blueprint", headers=alice["h"]).status_code == 204
    assert stored_files(storage_root) == []
    assert client.get(f"{base}/blueprint", headers=alice["h"]).status_code == 404

    client.post(f"{base}/blueprint", files={"file": ("a.png", PNG2)}, headers=alice["h"])
    assert len(stored_files(storage_root)) == 1
    assert client.delete(f"/api/v1/projects/{project['id']}", headers=alice["h"]).status_code == 204
    assert stored_files(storage_root) == []


def test_duplicate_export_import_keep_blueprint(floor_ctx, storage_root):
    alice, _, base, floor_id, project = floor_ctx
    pid = project["id"]
    client.post(
        f"{base}/blueprint",
        files={"file": ("a.png", PNG)},
        data={
            "scale_mm_per_pixel": "5",
            "origin_x": "7",
            "rotation_deg": "30",
            "crop": "1,2,3,4",
            "pdf_page": "2",
        },
        headers=alice["h"],
    )

    dup_response = client.post(f"{base}/duplicate", headers=alice["h"])
    assert dup_response.status_code == 201, dup_response.text
    dup = dup_response.json()
    dup_url = f"/api/v1/projects/{pid}/floors/{dup['id']}/blueprint"
    meta = client.get(dup_url, headers=alice["h"]).json()
    assert (meta["scale_mm_per_pixel"], meta["origin_x"], meta["rotation_deg"]) == (
        5,
        7,
        30,
    )
    assert meta["pdf_page"] == 2
    assert client.get(f"{dup_url}/content", headers=alice["h"]).content == PNG
    assert len(stored_files(storage_root)) == 2
    client.delete(dup_url, headers=alice["h"])
    assert client.get(f"{base}/blueprint/content", headers=alice["h"]).content == PNG

    exported = client.get(f"/api/v1/projects/{pid}/export", headers=alice["h"]).json()
    assert exported["buildings"][0]["floors"][0]["blueprint"]["origin_x"] == 7
    org_id = client.get(f"/api/v1/projects/{pid}", headers=alice["h"]).json()["organization_id"]
    imported = client.post(
        "/api/v1/projects/import",
        json={**exported, "organization_id": org_id},
        headers=alice["h"],
    )
    assert imported.status_code == 201, imported.text
    new_pid = imported.json()["id"]
    new_floor = client.get(f"/api/v1/projects/{new_pid}/buildings", headers=alice["h"]).json()[0][
        "floors"
    ][0]
    new_url = f"/api/v1/projects/{new_pid}/floors/{new_floor['id']}/blueprint"
    assert client.get(f"{new_url}/content", headers=alice["h"]).content == PNG

    dup_project = client.post(f"/api/v1/projects/{pid}/duplicate", headers=alice["h"]).json()
    floor = client.get(
        f"/api/v1/projects/{dup_project['id']}/buildings", headers=alice["h"]
    ).json()[0]["floors"][0]
    url = f"/api/v1/projects/{dup_project['id']}/floors/{floor['id']}/blueprint"
    assert client.get(f"{url}/content", headers=alice["h"]).content == PNG

    exported["buildings"][0]["floors"][0]["blueprint"]["content_base64"] = "bm90IGFuIGltYWdl"
    bad = client.post(
        "/api/v1/projects/import",
        json={**exported, "organization_id": org_id},
        headers=alice["h"],
    )
    assert bad.status_code == 415
    before = len(stored_files(storage_root))
    assert before == 3


def test_pdf_original_is_stored_and_page_persists(floor_ctx, storage_root):
    alice, _, base, _, _ = floor_ctx
    pdf = b"%PDF-1.4\n" + b"0" * 64
    r = client.post(
        f"{base}/blueprint",
        files={"file": ("plan.pdf", pdf)},
        data={"pdf_page": "3"},
        headers=alice["h"],
    )
    assert r.status_code == 201, r.text
    assert r.json()["content_type"] == "application/pdf" and r.json()["pdf_page"] == 3
    assert client.get(f"{base}/blueprint/content", headers=alice["h"]).content == pdf
    patched = client.patch(
        f"{base}/blueprint/calibration", json={"pdf_page": 5}, headers=alice["h"]
    )
    assert patched.json()["pdf_page"] == 5
    assert (
        client.patch(
            f"{base}/blueprint/calibration", json={"pdf_page": 0}, headers=alice["h"]
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"{base}/blueprint/calibration", json={"pdf_page": None}, headers=alice["h"]
        ).status_code
        == 422
    )
    assert client.get(f"{base}/blueprint", headers=alice["h"]).json()["pdf_page"] == 5


def test_shared_link_exposes_blueprint_with_password(floor_ctx, storage_root):
    alice, _, base, floor_id, project = floor_ctx
    pid = project["id"]
    client.post(f"{base}/blueprint", files={"file": ("a.png", PNG)}, headers=alice["h"])
    share = client.post(
        f"/api/v1/projects/{pid}/shares",
        json={"client_view": True, "password": "s3cret-pw"},
        headers=alice["h"],
    ).json()
    url = f"/api/v1/projects/shared/{share['token']}"
    pw = {"X-Share-Password": "s3cret-pw"}

    assert client.get(url).status_code == 401
    shared = client.get(url, headers=pw).json()
    assert shared["buildings"][0]["floors"][0]["blueprint"]["content_type"] == "image/png"
    content_url = f"{url}/floors/{floor_id}/blueprint/content"
    assert client.get(content_url).status_code == 401
    assert client.get(content_url, headers={"X-Share-Password": "wrong"}).status_code == 401
    assert client.get(content_url, headers=pw).content == PNG
    assert (
        client.get(f"{url}/floors/{floor_id + 9999}/blueprint/content", headers=pw).status_code
        == 404
    )
