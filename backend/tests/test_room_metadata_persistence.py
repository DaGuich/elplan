"""Room type / installation standard round trip through the floor-plan API.

Skipped until RoomPlanItem includes RoomMetadataMixin."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.project import RoomPlanItem
from tests.test_access import make_user

pytestmark = pytest.mark.skipif(
    "room_type" not in RoomPlanItem.model_fields,
    reason="RoomPlanItem not yet wired to RoomMetadataMixin",
)

client = TestClient(app)
BASE = {"id": "r1", "name": "Bad", "x": 10, "y": 10, "width": 100, "height": 80}


@pytest.fixture()
def plan_url():
    headers = make_user("meta")["h"]
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


def _rooms(url, headers):
    return {r["id"]: r for r in client.get(url, headers=headers).json()["rooms"]}


def test_metadata_round_trip_trims_and_normalizes_blank(plan_url):
    url, headers = plan_url
    rooms = [
        {**BASE, "room_type": " Bad ", "installation_standard": " RAL-RG 678 "},
        {**BASE, "id": "r2", "room_type": "  ", "installation_standard": ""},
        {**BASE, "id": "r3", "x": 200},
    ]
    assert client.put(url, json={"rooms": rooms}, headers=headers).status_code == 200
    stored = _rooms(url, headers)
    assert (stored["r1"]["room_type"], stored["r1"]["installation_standard"]) == (
        "Bad",
        "RAL-RG 678",
    )
    assert stored["r2"]["room_type"] is None and stored["r2"]["installation_standard"] is None
    assert stored["r3"]["room_type"] is None


@pytest.mark.parametrize(
    "room",
    [
        {**BASE, "room_type": "x" * 81},
        {**BASE, "installation_standard": "x" * 201},
        {**BASE, "name": "n" * 121},
        {**BASE, "name": ""},
    ],
)
def test_invalid_metadata_rejected_and_stored_plan_unchanged(plan_url, room):
    url, headers = plan_url
    assert client.put(url, json={"rooms": [BASE]}, headers=headers).status_code == 200
    assert client.put(url, json={"rooms": [room]}, headers=headers).status_code == 422
    assert _rooms(url, headers)["r1"]["name"] == "Bad"


def test_boundary_lengths_accepted(plan_url):
    url, headers = plan_url
    room = {
        **BASE,
        "name": "n" * 120,
        "room_type": "t" * 80,
        "installation_standard": "s" * 200,
    }
    assert client.put(url, json={"rooms": [room]}, headers=headers).status_code == 200
    stored = _rooms(url, headers)["r1"]
    assert (
        len(stored["name"]) == 120
        and len(stored["room_type"]) == 80
        and len(stored["installation_standard"]) == 200
    )
