"""Integration tests; require DATABASE_URL pointing at a migrated Postgres."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app

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
