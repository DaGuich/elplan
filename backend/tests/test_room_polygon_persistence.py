"""Persistence of room polygons through the floor-plan API (needs the migrated Postgres, like test_access)."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.test_access import make_user

client = TestClient(app)

ELL = [[10, 10], [210, 10], [210, 110], [110, 110], [110, 210], [10, 210]]
LEGACY = {"id": "old", "name": "Kitchen", "x": 300, "y": 20, "width": 100, "height": 80}
DETECTED = {
    "id": "det",
    "name": "Detected room 1",
    "x": 10,
    "y": 10,
    "width": 200,
    "height": 200,
    "polygon": ELL,
    "holes": [[[20, 20], [40, 20], [40, 40], [20, 40]]],
    "source": "detected",
    "needs_review": True,
}


@pytest.fixture()
def plan_url():
    headers = make_user("poly")["h"]
    org = client.post("/api/v1/organizations", json={"name": "Acme"}, headers=headers).json()
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "P"},
        headers=headers,
    ).json()
    building = client.post(
        f"/api/v1/projects/{project['id']}/buildings",
        json={"name": "B", "floors": [{"name": "F"}]},
        headers=headers,
    ).json()
    return (
        f"/api/v1/projects/{project['id']}/floors/{building['floors'][0]['id']}/plan",
        headers,
    )


def test_polygon_rooms_round_trip_and_legacy_rooms_survive(plan_url):
    url, headers = plan_url
    saved = client.put(url, json={"rooms": [LEGACY, DETECTED]}, headers=headers)
    assert saved.status_code == 200, saved.text
    rooms = {room["id"]: room for room in client.get(url, headers=headers).json()["rooms"]}
    assert rooms["det"]["polygon"] == ELL
    assert rooms["det"]["holes"] == DETECTED["holes"]
    assert rooms["det"]["source"] == "detected" and rooms["det"]["needs_review"] is True
    assert rooms["old"]["polygon"] is None and rooms["old"]["source"] == "manual"
    assert (rooms["old"]["x"], rooms["old"]["width"]) == (300, 100)


def test_invalid_polygon_is_rejected_and_stored_plan_is_unchanged(plan_url):
    url, headers = plan_url
    assert client.put(url, json={"rooms": [LEGACY]}, headers=headers).status_code == 200
    bowtie = {
        **DETECTED,
        "polygon": [[10, 10], [210, 210], [210, 10], [10, 210]],
        "holes": [],
    }
    assert client.put(url, json={"rooms": [bowtie]}, headers=headers).status_code == 422
    assert [room["id"] for room in client.get(url, headers=headers).json()["rooms"]] == ["old"]
