"""image_crop_reference persistence through the floor-plan API: legacy plans stay untouched."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.test_access import make_user

client = TestClient(app)


def save_plan(url, body, headers):
    revision = client.get(url, headers=headers).json()["topology_revision"]
    return client.put(
        url,
        json={**body, "topology_revision": revision},
        headers=headers,
    )


@pytest.fixture()
def world():
    headers = make_user("crop")["h"]
    org = client.post("/api/v1/organizations", json={"name": "Acme"}, headers=headers).json()
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "P"},
        headers=headers,
    ).json()
    building = client.post(
        f"/api/v1/projects/{project['id']}/buildings",
        json={"name": "B", "floors": [{"name": "F1"}, {"name": "F2"}]},
        headers=headers,
    ).json()
    base = f"/api/v1/projects/{project['id']}"
    return base, [floor["id"] for floor in building["floors"]], headers


def test_legacy_crop_without_reference_round_trips_unchanged(world):
    base, floors, headers = world
    url = f"{base}/floors/{floors[0]}/plan"
    assert (
        save_plan(
            url,
            {"image_crop": [0.1, 0.1, 0.5, 0.5], "background_rotation": 90},
            headers,
        ).status_code
        == 200
    )
    stored = client.get(url, headers=headers).json()
    assert stored["image_crop"] == [0.1, 0.1, 0.5, 0.5]
    assert stored["image_crop_reference"] is None
    assert stored["background_rotation"] == 90


def test_reference_is_persisted_per_floor_and_survives_crop_edits(world):
    base, floors, headers = world
    first, second = (f"{base}/floors/{floor}/plan" for floor in floors)
    body = {
        "image_crop": [0.2, 0.2, 0.3, 0.3],
        "image_crop_reference": [0.1, 0.1, 0.5, 0.5],
        "scale_m_per_100_units": 2.5,
    }
    assert save_plan(first, body, headers).status_code == 200
    assert save_plan(second, {"image_crop": [0, 0, 1, 1]}, headers).status_code == 200
    stored = client.get(first, headers=headers).json()
    assert stored["image_crop_reference"] == [0.1, 0.1, 0.5, 0.5]
    assert stored["scale_m_per_100_units"] == 2.5
    assert client.get(second, headers=headers).json()["image_crop_reference"] is None
    body["image_crop"] = None
    assert save_plan(first, body, headers).status_code == 200
    reset = client.get(first, headers=headers).json()
    assert reset["image_crop"] is None and reset["image_crop_reference"] == [
        0.1,
        0.1,
        0.5,
        0.5,
    ]


def test_invalid_reference_is_rejected_and_stored_plan_unchanged(world):
    base, floors, headers = world
    url = f"{base}/floors/{floors[0]}/plan"
    good = {
        "image_crop": [0.1, 0.1, 0.5, 0.5],
        "image_crop_reference": [0.1, 0.1, 0.5, 0.5],
    }
    assert save_plan(url, good, headers).status_code == 200
    for bad in ([0.5, 0.5, 0.6, 0.6], [0, 0, 0, 1], [-0.1, 0, 0.5, 0.5], [0, 0, 1]):
        assert save_plan(url, {"image_crop_reference": bad}, headers).status_code == 422
    assert client.get(url, headers=headers).json()["image_crop_reference"] == [
        0.1,
        0.1,
        0.5,
        0.5,
    ]


def test_floor_duplicate_keeps_registration(world):
    base, floors, headers = world
    url = f"{base}/floors/{floors[0]}/plan"
    body = {
        "image_crop": [0.2, 0.2, 0.3, 0.3],
        "image_crop_reference": [0.1, 0.1, 0.5, 0.5],
    }
    assert save_plan(url, body, headers).status_code == 200
    copied = client.post(f"{base}/floors/{floors[0]}/duplicate", headers=headers)
    assert copied.status_code == 201, copied.text
    copy_url = f"{base}/floors/{copied.json()['id']}/plan"
    stored = client.get(copy_url, headers=headers).json()
    assert (
        stored["image_crop"] == body["image_crop"]
        and stored["image_crop_reference"] == body["image_crop_reference"]
    )
