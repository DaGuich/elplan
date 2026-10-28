"""Integration tests; require DATABASE_URL pointing at a migrated Postgres."""
import uuid

import pytest
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def make_user(name):
    email = f"{name}-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/api/v1/auth/register", json={"email": email, "name": name, "password": "password123"})
    assert r.status_code == 201, r.text
    token = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"}).json()[
        "access_token"
    ]
    return {"id": r.json()["id"], "email": email, "h": {"Authorization": f"Bearer {token}"}}


@pytest.fixture()
def world():
    alice, bob, eve = make_user("alice"), make_user("bob"), make_user("eve")
    org = client.post("/api/v1/organizations", json={"name": "Acme"}, headers=alice["h"]).json()
    r = client.post(
        f"/api/v1/organizations/{org['id']}/members", json={"email": bob["email"]}, headers=alice["h"]
    )
    assert r.status_code == 201
    return alice, bob, eve, org


def test_requires_auth():
    assert client.get("/api/v1/projects").status_code == 401


def test_org_visibility(world):
    alice, bob, eve, org = world
    p = client.post(
        "/api/v1/projects", json={"organization_id": org["id"], "name": "P"}, headers=alice["h"]
    ).json()
    assert [x["id"] for x in client.get("/api/v1/projects", headers=bob["h"]).json()] == [p["id"]]
    assert client.get("/api/v1/projects", headers=eve["h"]).json() == []
    for method in ("GET", "PATCH", "DELETE"):
        r = client.request(method, f"/api/v1/projects/{p['id']}", json={"name": "x"}, headers=eve["h"])
        assert r.status_code == 404
    assert (
        client.post(
            "/api/v1/projects", json={"organization_id": org["id"], "name": "X"}, headers=eve["h"]
        ).status_code
        == 404
    )


def test_building_requires_floors_and_obeys_project_access(world):
    alice, _, eve, org = world
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "Office"},
        headers=alice["h"],
    ).json()
    url = f"/api/v1/projects/{project['id']}/buildings"

    empty = client.post(url, json={"name": "Main", "floors": []}, headers=alice["h"])
    assert empty.status_code == 422

    created = client.post(
        url,
        json={"name": "Main", "floors": [{"name": "Ground floor"}, {"name": "First floor"}]},
        headers=alice["h"],
    )
    assert created.status_code == 201, created.text
    building = created.json()
    assert building["name"] == "Main"
    assert [floor["name"] for floor in building["floors"]] == ["Ground floor", "First floor"]
    assert [floor["sort_order"] for floor in building["floors"]] == [0, 1]
    assert [row["id"] for row in client.get(url, headers=alice["h"]).json()] == [building["id"]]
    assert client.get(url, headers=eve["h"]).status_code == 404
    assert client.post(
        url,
        json={"name": "No access", "floors": [{"name": "Ground floor"}]},
        headers=eve["h"],
    ).status_code == 404


def test_floor_plan_is_persistent_and_project_scoped(world):
    alice, _, eve, org = world
    project = client.post(
        "/api/v1/projects", json={"organization_id": org["id"], "name": "Planning"}, headers=alice["h"]
    ).json()
    building = client.post(
        f"/api/v1/projects/{project['id']}/buildings",
        json={"name": "Main", "floors": [{"name": "Ground floor"}]},
        headers=alice["h"],
    ).json()
    floor_id = building["floors"][0]["id"]
    url = f"/api/v1/projects/{project['id']}/floors/{floor_id}/plan"
    assert client.get(url, headers=alice["h"]).json()["rooms"] == []

    rcd_id = "rcd-1"
    payload = {
        "background_image": None,
        "scale_m_per_100_units": 2.5,
        "rooms": [{"id": "room-1", "name": "Kitchen", "x": 20, "y": 30, "width": 200, "height": 120}],
        "placements": [{"id": "point-1", "kind": "socket", "label": "Socket", "x": 90, "y": 100}],
        "rcds": [{"id": rcd_id, "name": "RCD 1", "rated_current_ma": 30, "poles": 4}],
        "circuits": [
            {
                "id": "circuit-1",
                "name": "Kitchen sockets",
                "rcd_id": rcd_id,
                "breaker_type": "B",
                "rated_current_a": 16,
                "cable": "3×2.5 mm²",
                "loads": ["point-1"],
            }
        ],
    }
    saved = client.put(url, json=payload, headers=alice["h"])
    assert saved.status_code == 200, saved.text
    assert client.get(url, headers=alice["h"]).json() == saved.json()

    wrong_project = client.post(
        "/api/v1/projects", json={"organization_id": org["id"], "name": "Other"}, headers=alice["h"]
    ).json()
    wrong_url = f"/api/v1/projects/{wrong_project['id']}/floors/{floor_id}/plan"
    assert client.get(wrong_url, headers=alice["h"]).status_code == 404
    assert client.get(url, headers=eve["h"]).status_code == 404

    payload["circuits"][0]["rcd_id"] = "missing-rcd"
    assert client.put(url, json=payload, headers=alice["h"]).status_code == 422
    payload["circuits"][0]["rcd_id"] = rcd_id
    payload["circuits"][0]["loads"] = ["missing-point"]
    assert client.put(url, json=payload, headers=alice["h"]).status_code == 422
    assert client.put(url, json={"image_crop": [0.5, 0.5, 0.6, 0.6]}, headers=alice["h"]).status_code == 422


def test_project_archive_duplicate_export_and_floor_lifecycle(world):
    alice, _, _, org = world
    headers = alice["h"]
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "Villa", "description": "Original"},
        headers=headers,
    ).json()
    building = client.post(
        f"/api/v1/projects/{project['id']}/buildings",
        json={"name": "Main", "floors": [{"name": "Ground"}]},
        headers=headers,
    ).json()
    floor_id = building["floors"][0]["id"]
    plan_url = f"/api/v1/projects/{project['id']}/floors/{floor_id}/plan"
    payload = {
        "rooms": [{"id": "room", "name": "Hall", "x": 10, "y": 10, "width": 100, "height": 80}],
        "placements": [],
    }
    assert client.put(plan_url, json=payload, headers=headers).status_code == 200

    duplicated = client.post(f"/api/v1/projects/{project['id']}/duplicate", headers=headers)
    assert duplicated.status_code == 201, duplicated.text
    copied_building = client.get(
        f"/api/v1/projects/{duplicated.json()['id']}/buildings", headers=headers
    ).json()[0]
    copied_floor = copied_building["floors"][0]["id"]
    assert client.get(
        f"/api/v1/projects/{duplicated.json()['id']}/floors/{copied_floor}/plan", headers=headers
    ).json()["rooms"][0]["name"] == "Hall"

    exported = client.get(f"/api/v1/projects/{project['id']}/export", headers=headers)
    assert exported.status_code == 200
    imported = client.post(
        "/api/v1/projects/import",
        json={"organization_id": org["id"], "name": "Imported Villa", **exported.json()},
        headers=headers,
    )
    assert imported.status_code == 201, imported.text

    copied_floor_response = client.post(
        f"/api/v1/projects/{project['id']}/floors/{floor_id}/duplicate", headers=headers
    )
    assert copied_floor_response.status_code == 201
    new_floor_id = copied_floor_response.json()["id"]
    assert client.get(
        f"/api/v1/projects/{project['id']}/floors/{new_floor_id}/plan", headers=headers
    ).json()["rooms"][0]["name"] == "Hall"
    assert client.patch(
        f"/api/v1/projects/{project['id']}/floors/{new_floor_id}",
        json={"name": "First floor"},
        headers=headers,
    ).json()["name"] == "First floor"
    assert client.delete(
        f"/api/v1/projects/{project['id']}/floors/{new_floor_id}", headers=headers
    ).status_code == 204

    archived = client.patch(
        f"/api/v1/projects/{project['id']}", json={"archived": True}, headers=headers
    )
    assert archived.json()["archived"] is True
    assert project["id"] not in [item["id"] for item in client.get("/api/v1/projects", headers=headers).json()]
    assert project["id"] in [
        item["id"]
        for item in client.get("/api/v1/projects?include_archived=true", headers=headers).json()
    ]


def test_password_protected_client_share_hides_technical_data(world):
    alice, _, eve, org = world
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "Client portal"},
        headers=alice["h"],
    ).json()
    building = client.post(
        f"/api/v1/projects/{project['id']}/buildings",
        json={"name": "Home", "floors": [{"name": "Ground"}]},
        headers=alice["h"],
    ).json()
    floor_id = building["floors"][0]["id"]
    data = {
        "layers": [
            {"id": "client", "name": "Client", "purpose": "client"},
            {"id": "technical", "name": "Technical", "purpose": "technical"},
        ],
        "rooms": [
            {"id": "room", "name": "Living room", "x": 10, "y": 10, "width": 100, "height": 80, "layer_id": "client"}
        ],
        "placements": [
            {
                "id": "public-load",
                "kind": "socket",
                "label": "Wall outlet",
                "x": 25,
                "y": 25,
                "layer_id": "client",
                "device_id": "device-1",
                "channel_id": "channel-1",
                "bus_address": "1.1.10",
            },
            {"id": "private-load", "kind": "switch", "label": "Internal circuit", "x": 35, "y": 35, "layer_id": "technical"},
        ],
        "smart_devices": [
            {
                "id": "device-1",
                "name": "KNX actuator",
                "system": "knx",
                "kind": "actuator",
                "channels": [
                    {"id": "channel-1", "name": "Output 1", "kind": "switching", "load_ids": ["public-load"]}
                ],
            }
        ],
        "annotation": {"notes": "Technician-only notes"},
    }
    floor_url = f"/api/v1/projects/{project['id']}/floors/{floor_id}/plan"
    assert client.put(floor_url, json=data, headers=alice["h"]).status_code == 200
    created = client.post(
        f"/api/v1/projects/{project['id']}/shares",
        json={"client_view": True, "password": "client-password"},
        headers=alice["h"],
    )
    assert created.status_code == 201
    token = created.json()["token"]
    shared_url = f"/api/v1/projects/shared/{token}"
    assert client.get(shared_url).status_code == 401
    public = client.get(shared_url, headers={"X-Share-Password": "client-password"})
    assert public.status_code == 200, public.text
    shared_plan = public.json()["buildings"][0]["floors"][0]["plan_data"]
    assert [item["label"] for item in shared_plan["placements"]] == ["Wall outlet"]
    assert shared_plan["placements"][0]["device_id"] is None
    assert shared_plan["placements"][0]["channel_id"] is None
    assert shared_plan["placements"][0]["bus_address"] is None
    assert shared_plan["annotation"]["notes"] == ""
    assert shared_plan["circuits"] == []
    assert shared_plan["smart_devices"] == []
    assert client.delete(
        f"/api/v1/projects/{project['id']}/shares/{created.json()['id']}", headers=alice["h"]
    ).status_code == 204
    assert client.get(shared_url, headers={"X-Share-Password": "client-password"}).status_code == 404


def test_team_visibility(world):
    alice, bob, eve, org = world
    team = client.post(
        f"/api/v1/organizations/{org['id']}/teams", json={"name": "Core"}, headers=alice["h"]
    ).json()
    p = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "T", "team_id": team["id"]},
        headers=alice["h"],
    ).json()
    # Bob is an org member but not in the team.
    assert client.get("/api/v1/projects", headers=bob["h"]).json() == []
    assert client.get(f"/api/v1/projects/{p['id']}", headers=bob["h"]).status_code == 404
    assert client.delete(f"/api/v1/projects/{p['id']}", headers=bob["h"]).status_code == 404
    # Non-admin cannot manage teams.
    r = client.post(
        f"/api/v1/organizations/{org['id']}/teams/{team['id']}/members",
        json={"user_id": bob["id"]},
        headers=bob["h"],
    )
    assert r.status_code == 403
    client.post(
        f"/api/v1/organizations/{org['id']}/teams/{team['id']}/members",
        json={"user_id": bob["id"]},
        headers=alice["h"],
    )
    assert client.get(f"/api/v1/projects/{p['id']}", headers=bob["h"]).status_code == 200
    r = client.patch(f"/api/v1/projects/{p['id']}", json={"name": "New"}, headers=bob["h"])
    assert r.json()["name"] == "New"
    assert client.delete(f"/api/v1/projects/{p['id']}", headers=bob["h"]).status_code == 204


def test_team_with_projects_cannot_be_deleted(world):
    alice, bob, _, org = world
    team = client.post(
        f"/api/v1/organizations/{org['id']}/teams", json={"name": "Core"}, headers=alice["h"]
    ).json()
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "T", "team_id": team["id"]},
        headers=alice["h"],
    ).json()

    r = client.delete(f"/api/v1/organizations/{org['id']}/teams/{team['id']}", headers=alice["h"])

    assert r.status_code == 409
    assert client.get(f"/api/v1/projects/{project['id']}", headers=bob["h"]).status_code == 404
    assert client.delete(f"/api/v1/projects/{project['id']}", headers=alice["h"]).status_code == 204
    r = client.delete(f"/api/v1/organizations/{org['id']}/teams/{team['id']}", headers=alice["h"])
    assert r.status_code == 204


def test_last_owner_protected(world):
    alice, _, _, org = world
    r = client.delete(f"/api/v1/organizations/{org['id']}/members/{alice['id']}", headers=alice["h"])
    assert r.status_code == 400
