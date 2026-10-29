"""Integration tests; require DATABASE_URL pointing at a migrated Postgres."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.security import UNUSABLE_PASSWORD, create_access_token
from app.main import app
from app.models.project import Floor, Project
from app.models.user import User


class RevisionAwareTestClient(TestClient):
    def request(self, method, url, **kwargs):
        path = url.split("?", 1)[0].split("/")
        if (
            method.upper() in {"POST", "PUT", "PATCH", "DELETE"}
            and len(path) >= 6
            and path[1:4] == ["api", "v1", "projects"]
            and path[5] in {"boards", "circuits", "loads"}
        ):
            headers = dict(kwargs.get("headers") or {})
            if not any(key.lower() == "if-match" for key in headers):
                with SessionLocal() as db:
                    revision = db.scalar(
                        select(Project.topology_revision).where(Project.id == int(path[4]))
                    )
                headers["If-Match"] = str(revision)
                kwargs["headers"] = headers
        return super().request(method, url, **kwargs)


client = RevisionAwareTestClient(app)


def make_user(name):
    email = f"{name}-{uuid.uuid4().hex[:8]}@example.com"
    with SessionLocal() as db:
        user = User(email=email, name=name, password_hash=UNUSABLE_PASSWORD)
        db.add(user)
        db.commit()
        db.refresh(user)
        return {
            "id": user.id,
            "email": email,
            "h": {"Authorization": f"Bearer {create_access_token(user.id)}"},
        }


@pytest.fixture()
def world():
    alice, bob, eve = make_user("alice"), make_user("bob"), make_user("eve")
    org = client.post("/api/v1/organizations", json={"name": "Acme"}, headers=alice["h"]).json()
    r = client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": bob["email"]},
        headers=alice["h"],
    )
    assert r.status_code == 201
    return alice, bob, eve, org


def test_requires_auth():
    assert client.get("/api/v1/projects").status_code == 401


def test_rcd_uses_explicit_project_board_when_multiple_boards_exist(world):
    alice, _, _, org = world
    headers = alice["h"]
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "Multiple boards"},
        headers=headers,
    ).json()
    base = f"/api/v1/projects/{project['id']}"
    floor = client.post(
        f"{base}/buildings",
        json={"name": "Building", "floors": [{"name": "Floor"}]},
        headers=headers,
    ).json()["floors"][0]
    first = client.post(f"{base}/boards", json={"name": "Main"}, headers=headers).json()
    second = client.post(f"{base}/boards", json={"name": "HVAC"}, headers=headers).json()
    plan_url = f"{base}/floors/{floor['id']}/plan"
    plan = client.get(plan_url, headers=headers).json()
    rcd = {"id": "test-rcd", "name": "FI", "rated_current_ma": 30, "poles": 4, "type": "A"}
    plan["rcds"] = [rcd]

    assert client.put(plan_url, json=plan, headers=headers).status_code == 409
    plan["rcds"][0]["board_id"] = second["id"]
    result = client.put(plan_url, json=plan, headers=headers)
    assert result.status_code == 200, result.text
    assert result.json()["rcds"][0]["board_id"] == second["id"]
    boards = client.get(f"{base}/boards", headers=headers).json()
    assert not boards[0]["data"].get("rcds")
    assert boards[1]["data"]["rcds"][0]["id"] == "test-rcd"
    assert "board_id" not in boards[1]["data"]["rcds"][0]

    copied = client.post(f"{base}/duplicate", headers=headers)
    assert copied.status_code == 201, copied.text
    copy_base = f"/api/v1/projects/{copied.json()['id']}"
    copy_boards = client.get(f"{copy_base}/boards", headers=headers).json()
    copy_floor = client.get(f"{copy_base}/buildings", headers=headers).json()[0]["floors"][0]
    copy_plan = client.get(f"{copy_base}/floors/{copy_floor['id']}/plan", headers=headers).json()
    assert copy_plan["rcds"][0]["board_id"] == copy_boards[1]["id"]

    plan = result.json()
    plan["rcds"][0]["board_id"] = first["id"]
    assert client.put(plan_url, json=plan, headers=headers).status_code == 409
    plan["rcds"][0]["board_id"] = second["id"] + 999_999
    assert client.put(plan_url, json=plan, headers=headers).status_code == 409
    assert client.get(plan_url, headers=headers).json()["rcds"][0]["board_id"] == second["id"]


def test_plan_circuit_edits_synchronize_remote_floor_placements(world):
    alice, _, _, org = world
    headers = alice["h"]
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "Cross-floor synchronization"},
        headers=headers,
    ).json()
    base = f"/api/v1/projects/{project['id']}"
    floors = client.post(
        f"{base}/buildings",
        json={"name": "Building", "floors": [{"name": "Ground"}, {"name": "Upper"}]},
        headers=headers,
    ).json()["floors"]
    ground_url = f"{base}/floors/{floors[0]['id']}/plan"
    upper_url = f"{base}/floors/{floors[1]['id']}/plan"
    upper = client.get(upper_url, headers=headers).json()
    upper["placements"] = [{"id": "remote", "kind": "light", "label": "Lamp", "x": 20, "y": 30}]
    assert client.put(upper_url, json=upper, headers=headers).status_code == 200
    ground = client.get(ground_url, headers=headers).json()
    ground["rcds"] = [{"id": "fi", "name": "FI", "rated_current_ma": 30, "poles": 4, "type": "A"}]
    ground["circuits"] = [
        {"id": circuit, "name": circuit, "rcd_id": "fi", "breaker_type": "B",
         "rated_current_a": 10, "poles": 1, "cable": "3x1.5", "supply": "1n",
         "loads": ["remote"] if circuit == "first" else []}
        for circuit in ("first", "second")
    ]
    saved = client.put(ground_url, json=ground, headers=headers)
    assert saved.status_code == 200, saved.text
    assert client.get(upper_url, headers=headers).json()["placements"][0]["circuit_id"] == "first"

    duplicate = saved.json()
    duplicate["circuits"][1]["loads"] = ["remote"]
    rejected = client.put(ground_url, json=duplicate, headers=headers)
    assert rejected.status_code == 422, rejected.text
    duplicate["circuits"][1]["loads"] = []
    duplicate["circuits"][0]["loads"] = ["remote", "remote"]
    rejected = client.put(ground_url, json=duplicate, headers=headers)
    assert rejected.status_code == 422, rejected.text
    duplicate["circuits"][0]["loads"] = ["remote"]
    duplicate["placements"] = [{"id": "remote", "kind": "light", "label": "Duplicate", "x": 1, "y": 2}]
    rejected = client.put(ground_url, json=duplicate, headers=headers)
    assert rejected.status_code == 422, rejected.text
    assert client.get(upper_url, headers=headers).json()["placements"][0]["circuit_id"] == "first"

    ground = saved.json()
    ground["circuits"][0]["loads"] = []
    ground["circuits"][1]["loads"] = ["remote"]
    saved = client.put(ground_url, json=ground, headers=headers)
    assert saved.status_code == 200, saved.text
    assert client.get(upper_url, headers=headers).json()["placements"][0]["circuit_id"] == "second"

    ground = saved.json()
    ground["circuits"][1]["loads"] = []
    saved = client.put(ground_url, json=ground, headers=headers)
    assert saved.status_code == 200, saved.text
    assert client.get(upper_url, headers=headers).json()["placements"][0]["circuit_id"] is None


def test_plan_local_placement_assignment_matches_circuit_loads(world):
    alice, _, _, org = world
    headers = alice["h"]
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "Local synchronization"},
        headers=headers,
    ).json()
    base = f"/api/v1/projects/{project['id']}"
    floor = client.post(
        f"{base}/buildings",
        json={"name": "Building", "floors": [{"name": "Ground"}]},
        headers=headers,
    ).json()["floors"][0]
    url = f"{base}/floors/{floor['id']}/plan"
    plan = client.get(url, headers=headers).json()
    plan["placements"] = [{"id": "lamp", "kind": "light", "label": "Lamp", "x": 20, "y": 30}]
    plan["rcds"] = [{"id": "fi", "name": "FI", "rated_current_ma": 30, "poles": 4, "type": "A"}]
    plan["circuits"] = [
        {"id": circuit, "name": circuit, "rcd_id": "fi", "breaker_type": "B",
         "rated_current_a": 10, "poles": 1, "cable": "3x1.5", "supply": "1n",
         "loads": ["lamp"] if circuit == "first" else []}
        for circuit in ("first", "second")
    ]
    saved = client.put(url, json=plan, headers=headers)
    assert saved.status_code == 200, saved.text
    assert saved.json()["placements"][0]["circuit_id"] == "first"
    plan = saved.json()
    plan["placements"][0]["circuit_id"] = "second"
    rejected = client.put(url, json=plan, headers=headers)
    assert rejected.status_code == 422, rejected.text
    assert client.get(url, headers=headers).json()["placements"][0]["circuit_id"] == "first"


def test_org_visibility(world):
    alice, bob, eve, org = world
    p = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "P"},
        headers=alice["h"],
    ).json()
    assert [x["id"] for x in client.get("/api/v1/projects", headers=bob["h"]).json()] == [p["id"]]
    assert client.get("/api/v1/projects", headers=eve["h"]).json() == []
    for method in ("GET", "PATCH", "DELETE"):
        r = client.request(
            method, f"/api/v1/projects/{p['id']}", json={"name": "x"}, headers=eve["h"]
        )
        assert r.status_code == 404
    assert (
        client.post(
            "/api/v1/projects",
            json={"organization_id": org["id"], "name": "X"},
            headers=eve["h"],
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
        json={
            "name": "Main",
            "floors": [{"name": "Ground floor"}, {"name": "First floor"}],
        },
        headers=alice["h"],
    )
    assert created.status_code == 201, created.text
    building = created.json()
    assert building["name"] == "Main"
    assert [floor["name"] for floor in building["floors"]] == [
        "Ground floor",
        "First floor",
    ]
    assert [floor["sort_order"] for floor in building["floors"]] == [0, 1]
    assert [row["id"] for row in client.get(url, headers=alice["h"]).json()] == [building["id"]]
    assert client.get(url, headers=eve["h"]).status_code == 404
    assert (
        client.post(
            url,
            json={"name": "No access", "floors": [{"name": "Ground floor"}]},
            headers=eve["h"],
        ).status_code
        == 404
    )


def test_floor_plan_is_persistent_and_project_scoped(world):
    alice, _, eve, org = world
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "Planning"},
        headers=alice["h"],
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
        "rooms": [
            {
                "id": "room-1",
                "name": "Kitchen",
                "x": 20,
                "y": 30,
                "width": 200,
                "height": 120,
            }
        ],
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
    assert saved.json()["circuits"][0]["loads"] == ["point-1"]
    exported = client.get(f"/api/v1/projects/{project['id']}/export", headers=alice["h"])
    assert exported.status_code == 200, exported.text
    topology_board = exported.json()["topology"]["boards"][0]
    assert topology_board["data"]["rcds"][0]["name"] == "RCD 1"
    assert topology_board["circuits"][0]["data"]["cable"] == "3×2.5 mm²"
    imported = client.post(
        "/api/v1/projects/import",
        json={
            "organization_id": org["id"],
            "name": "Legacy circuit import",
            **exported.json(),
        },
        headers=alice["h"],
    )
    assert imported.status_code == 201, imported.text
    imported_floor = client.get(
        f"/api/v1/projects/{imported.json()['id']}/buildings", headers=alice["h"]
    ).json()[0]["floors"][0]
    imported_plan = client.get(
        f"/api/v1/projects/{imported.json()['id']}/floors/{imported_floor['id']}/plan",
        headers=alice["h"],
    ).json()
    assert imported_plan["circuits"][0]["name"] == "Kitchen sockets"
    assert imported_plan["circuits"][0]["loads"] == ["point-1"]

    wrong_project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "Other"},
        headers=alice["h"],
    ).json()
    wrong_url = f"/api/v1/projects/{wrong_project['id']}/floors/{floor_id}/plan"
    assert client.get(wrong_url, headers=alice["h"]).status_code == 404
    assert client.get(url, headers=eve["h"]).status_code == 404

    payload["topology_revision"] = client.get(url, headers=alice["h"]).json()["topology_revision"]
    payload["circuits"][0]["rcd_id"] = "missing-rcd"
    assert client.put(url, json=payload, headers=alice["h"]).status_code == 422
    payload["circuits"][0]["rcd_id"] = rcd_id
    payload["circuits"][0]["loads"] = ["missing-point"]
    assert client.put(url, json=payload, headers=alice["h"]).status_code == 422
    assert (
        client.put(
            url,
            json={
                "image_crop": [0.5, 0.5, 0.6, 0.6],
                "topology_revision": payload["topology_revision"],
            },
            headers=alice["h"],
        ).status_code
        == 422
    )


def test_distribution_topology_is_project_scoped_and_cross_floor(world):
    alice, _, eve, org = world
    headers = alice["h"]
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "Topology"},
        headers=headers,
    ).json()
    other = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "Other"},
        headers=headers,
    ).json()
    building = client.post(
        f"/api/v1/projects/{project['id']}/buildings",
        json={
            "name": "Main",
            "floors": [{"name": "Ground"}, {"name": "First"}, {"name": "Second"}],
        },
        headers=headers,
    ).json()
    floor_a, floor_b, floor_c = [floor["id"] for floor in building["floors"]]
    other_floor = client.post(
        f"/api/v1/projects/{other['id']}/buildings",
        json={"name": "Other", "floors": [{"name": "Floor"}]},
        headers=headers,
    ).json()["floors"][0]["id"]
    assert (
        client.put(
            f"/api/v1/projects/{project['id']}/floors/{floor_b}/plan",
            json={
                "placements": [
                    {
                        "id": "remote-light",
                        "kind": "light",
                        "label": "Remote light",
                        "x": 20,
                        "y": 30,
                    }
                ]
            },
            headers=headers,
        ).status_code
        == 200
    )
    placements = client.get(
        f"/api/v1/projects/{project['id']}/topology/placements", headers=headers
    )
    assert placements.status_code == 200
    assert placements.json() == [
        {
            "id": "remote-light",
            "floor_id": floor_b,
            "floor_name": "First",
            "label": "Remote light",
        }
    ]
    boards_url = f"/api/v1/projects/{project['id']}/boards"
    assert client.get(boards_url, headers=headers).json() == []
    assert (
        client.post(
            boards_url,
            json={"name": "Invalid", "floor_id": other_floor},
            headers=headers,
        ).status_code
        == 404
    )
    rcd_data = {
        "id": "rcd-main",
        "name": "Main RCD",
        "rated_current_ma": 30,
        "poles": 4,
        "type": "A",
    }
    board_a = client.post(
        boards_url,
        json={
            "name": "Main",
            "kind": "main",
            "floor_id": floor_a,
            "data": {"rcds": [rcd_data]},
        },
        headers=headers,
    )
    board_b = client.post(boards_url, json={"name": "HVAC", "floor_id": floor_a}, headers=headers)
    unlocated = client.post(boards_url, json={"name": "Unlocated"}, headers=headers)
    assert board_a.status_code == board_b.status_code == unlocated.status_code == 201
    assert unlocated.json()["floor_id"] is None
    assert [board["floor_id"] for board in client.get(boards_url, headers=headers).json()] == [
        floor_a,
        floor_a,
        None,
    ]
    circuit_url = f"{boards_url}/{board_a.json()['id']}/circuits"
    circuit_data = {
        "rcd_id": "rcd-main",
        "breaker_type": "B",
        "rated_current_a": 10,
        "poles": 1,
        "cable": "3×1.5 mm²",
        "supply": "1n",
    }
    circuit = client.post(
        circuit_url,
        json={"name": "Lighting", "source_id": "lighting-1", "data": circuit_data},
        headers=headers,
    )
    assert circuit.status_code == 201
    loads_url = f"/api/v1/projects/{project['id']}/circuits/{circuit.json()['id']}/loads"
    for floor_id in (floor_a, floor_b, floor_c):
        body = {"name": "Light", "floor_id": floor_id}
        if floor_id == floor_b:
            body["placement_id"] = "remote-light"
        assert client.post(loads_url, json=body, headers=headers).status_code == 201
    assert (
        client.post(
            loads_url,
            json={"name": "Invalid", "floor_id": other_floor},
            headers=headers,
        ).status_code
        == 404
    )
    assert (
        client.post(
            loads_url,
            json={
                "name": "Foreign placement",
                "floor_id": floor_a,
                "placement_id": "remote-light",
            },
            headers=headers,
        ).status_code
        == 404
    )
    assert [load["floor_id"] for load in client.get(loads_url, headers=headers).json()] == [
        floor_a,
        floor_b,
        floor_c,
    ]
    assert client.get(loads_url, headers=headers).json()[1]["placement_id"] == "remote-light"
    assert (
        client.post(
            loads_url,
            json={"name": "Duplicate link", "placement_id": "remote-light"},
            headers=headers,
        ).status_code
        == 409
    )
    assert (
        client.get(
            f"/api/v1/projects/{project['id']}/floors/{floor_b}/plan", headers=headers
        ).json()["placements"][0]["circuit_id"]
        == "lighting-1"
    )
    assert (
        client.post(
            circuit_url,
            json={"name": "Duplicate source", "source_id": "lighting-1"},
            headers=headers,
        ).status_code
        == 409
    )
    assert client.get(boards_url, headers=eve["h"]).status_code == 404
    assert (
        client.get(
            f"/api/v1/projects/{project['id']}/topology/placements", headers=eve["h"]
        ).status_code
        == 404
    )
    assert (
        client.get(f"/api/v1/projects/{other['id']}/topology/placements", headers=headers).json()
        == []
    )
    assert (
        client.get(
            f"/api/v1/projects/{other['id']}/boards/{board_a.json()['id']}/circuits",
            headers=headers,
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/v1/projects/{other['id']}/circuits/{circuit.json()['id']}/loads",
            headers=headers,
        ).status_code
        == 404
    )
    exported = client.get(f"/api/v1/projects/{project['id']}/export", headers=headers)
    assert exported.status_code == 200, exported.text
    exported_board = exported.json()["topology"]["boards"][0]
    assert exported_board["floor_ref"] == [0, 0]
    assert [load["floor_ref"] for load in exported_board["circuits"][0]["loads"]] == [
        [0, 0],
        [0, 1],
        [0, 2],
    ]

    duplicated = client.post(f"/api/v1/projects/{project['id']}/duplicate", headers=headers)
    assert duplicated.status_code == 201, duplicated.text
    copied_building = client.get(
        f"/api/v1/projects/{duplicated.json()['id']}/buildings", headers=headers
    ).json()[0]
    copied_floors = copied_building["floors"]
    copied_boards = client.get(
        f"/api/v1/projects/{duplicated.json()['id']}/boards", headers=headers
    ).json()
    assert len(copied_boards) == 3
    assert copied_boards[0]["floor_id"] == copied_floors[0]["id"]
    copied_circuits = client.get(
        f"/api/v1/projects/{duplicated.json()['id']}/boards/{copied_boards[0]['id']}/circuits",
        headers=headers,
    ).json()
    assert len(copied_circuits) == 1
    copied_loads = client.get(
        f"/api/v1/projects/{duplicated.json()['id']}/circuits/{copied_circuits[0]['id']}/loads",
        headers=headers,
    ).json()
    assert [load["floor_id"] for load in copied_loads] == [floor["id"] for floor in copied_floors]
    assert {load["id"] for load in copied_loads}.isdisjoint(
        {load["id"] for load in client.get(loads_url, headers=headers).json()}
    )
    assert {board["id"] for board in copied_boards}.isdisjoint(
        {board["id"] for board in client.get(boards_url, headers=headers).json()}
    )
    assert {circuit["id"] for circuit in copied_circuits}.isdisjoint(
        {circuit["id"] for circuit in client.get(circuit_url, headers=headers).json()}
    )
    floor_copy = client.post(
        f"/api/v1/projects/{project['id']}/floors/{floor_b}/duplicate", headers=headers
    )
    assert floor_copy.status_code == 201, floor_copy.text
    copied_floor_id = floor_copy.json()["id"]
    copied_plan = client.get(
        f"/api/v1/projects/{project['id']}/floors/{copied_floor_id}/plan",
        headers=headers,
    ).json()
    copied_placement_id = copied_plan["placements"][0]["id"]
    assert copied_placement_id != "remote-light"
    assert copied_placement_id in copied_plan["circuits"][0]["loads"]
    assert (
        client.delete(
            f"/api/v1/projects/{project['id']}/floors/{copied_floor_id}",
            headers=headers,
        ).status_code
        == 204
    )
    invalid_topology = exported.json()
    invalid_topology["topology"]["boards"][0]["circuits"][0]["loads"][0]["floor_ref"] = [99, 99]
    invalid_import = client.post(
        "/api/v1/projects/import",
        json={
            "organization_id": org["id"],
            "name": "Invalid topology",
            **invalid_topology,
        },
        headers=headers,
    )
    assert invalid_import.status_code == 422
    imported = client.post(
        "/api/v1/projects/import",
        json={
            "organization_id": org["id"],
            "name": "Topology import",
            **exported.json(),
        },
        headers=headers,
    )
    assert imported.status_code == 201, imported.text
    imported_boards = client.get(
        f"/api/v1/projects/{imported.json()['id']}/boards", headers=headers
    ).json()
    assert len(imported_boards) == 3
    assert imported_boards[0]["floor_id"] != floor_a
    plan_c = client.get(
        f"/api/v1/projects/{project['id']}/floors/{floor_c}/plan", headers=headers
    ).json()
    plan_c["placements"].append(
        {
            "id": "deletion-light",
            "kind": "light",
            "label": "Deletion test",
            "x": 40,
            "y": 60,
        }
    )
    assert (
        client.put(
            f"/api/v1/projects/{project['id']}/floors/{floor_c}/plan",
            json=plan_c,
            headers=headers,
        ).status_code
        == 200
    )
    second_circuit = client.post(
        circuit_url,
        json={
            "name": "Deletion test",
            "source_id": "lighting-delete",
            "data": circuit_data,
        },
        headers=headers,
    )
    assert second_circuit.status_code == 201
    second_load_url = (
        f"/api/v1/projects/{project['id']}/circuits/{second_circuit.json()['id']}/loads"
    )
    linked_load = client.post(
        second_load_url,
        json={"name": "Deletion test", "placement_id": "deletion-light"},
        headers=headers,
    )
    assert linked_load.status_code == 201
    assert linked_load.json()["floor_id"] == floor_c
    assert (
        client.get(
            f"/api/v1/projects/{project['id']}/floors/{floor_c}/plan", headers=headers
        ).json()["placements"][0]["circuit_id"]
        == "lighting-delete"
    )
    assert (
        client.delete(
            f"/api/v1/projects/{project['id']}/circuits/{second_circuit.json()['id']}",
            headers=headers,
        ).status_code
        == 204
    )
    assert (
        client.get(
            f"/api/v1/projects/{project['id']}/floors/{floor_c}/plan", headers=headers
        ).json()["placements"][0]["circuit_id"]
        is None
    )
    board_url = f"{boards_url}/{board_b.json()['id']}"
    assert (
        client.put(
            board_url, json={"name": "HVAC", "floor_id": other_floor}, headers=headers
        ).status_code
        == 404
    )
    assert (
        client.put(board_url, json={"name": "HVAC", "floor_id": floor_b}, headers=headers).json()[
            "floor_id"
        ]
        == floor_b
    )
    assert client.delete(board_url, headers=eve["h"]).status_code == 404
    assert client.delete(board_url, headers=headers).status_code == 204
    loads = client.get(loads_url, headers=headers).json()
    load_url = f"/api/v1/projects/{project['id']}/loads/{loads[1]['id']}"
    assert (
        client.put(load_url, json={"name": "Moved", "floor_id": floor_c}, headers=headers).json()[
            "floor_id"
        ]
        == floor_c
    )
    assert client.delete(load_url, headers=headers).status_code == 204
    assert (
        client.delete(
            f"/api/v1/projects/{project['id']}/floors/{floor_a}", headers=headers
        ).status_code
        == 204
    )
    assert client.get(boards_url, headers=headers).json()[0]["floor_id"] is None
    assert client.get(loads_url, headers=headers).json()[0]["floor_id"] is None
    remaining_loads = client.get(loads_url, headers=headers).json()
    assert (
        client.delete(
            f"/api/v1/projects/{project['id']}/boards/{board_a.json()['id']}",
            headers=headers,
        ).status_code
        == 409
    )
    for load in remaining_loads:
        if load["placement_id"] is None:
            assert (
                client.delete(
                    f"/api/v1/projects/{project['id']}/loads/{load['id']}",
                    headers=headers,
                ).status_code
                == 204
            )
    removed_board = client.delete(f"{boards_url}/{board_a.json()['id']}", headers=headers)
    assert removed_board.status_code == 204, removed_board.text
    assert client.get(loads_url, headers=headers).status_code == 404


def test_stale_floor_plan_save_rejects_new_project_circuit_revision(world):
    alice, _, _, org = world
    headers = alice["h"]
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "Concurrent topology"},
        headers=headers,
    ).json()
    building = client.post(
        f"/api/v1/projects/{project['id']}/buildings",
        json={"name": "Main", "floors": [{"name": "Ground"}, {"name": "Upper"}]},
        headers=headers,
    ).json()
    ground, upper = [floor["id"] for floor in building["floors"]]
    rcd = {
        "id": "concurrent-rcd",
        "name": "RCD",
        "rated_current_ma": 30,
        "poles": 4,
        "type": "A",
    }
    initial_plan = {
        "placements": [
            {
                "id": "first-load",
                "kind": "light",
                "label": "First load",
                "x": 20,
                "y": 30,
            }
        ],
        "rcds": [rcd],
        "circuits": [
            {
                "id": "first-circuit",
                "name": "First circuit",
                "rcd_id": rcd["id"],
                "breaker_type": "B",
                "rated_current_a": 10,
                "poles": 1,
                "cable": "3×1.5 mm²",
                "loads": ["first-load"],
            }
        ],
    }
    ground_url = f"/api/v1/projects/{project['id']}/floors/{ground}/plan"
    upper_url = f"/api/v1/projects/{project['id']}/floors/{upper}/plan"
    assert client.put(ground_url, json=initial_plan, headers=headers).status_code == 200
    stale_upper = client.get(upper_url, headers=headers)
    assert stale_upper.status_code == 200, stale_upper.text
    assert [item["id"] for item in stale_upper.json()["circuits"]] == ["first-circuit"]

    board_id = client.get(f"/api/v1/projects/{project['id']}/boards", headers=headers).json()[0][
        "id"
    ]
    created = client.post(
        f"/api/v1/projects/{project['id']}/boards/{board_id}/circuits",
        json={
            "name": "Added while floor was open",
            "source_id": "concurrent-circuit",
            "data": {
                "rcd_id": rcd["id"],
                "breaker_type": "C",
                "rated_current_a": 16,
                "poles": 1,
                "cable": "3×2.5 mm²",
                "supply": "1n",
            },
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text

    stale_save = client.put(upper_url, json=stale_upper.json(), headers=headers)
    assert stale_save.status_code == 409, stale_save.text
    final = client.get(upper_url, headers=headers)
    assert final.status_code == 200, final.text
    assert {item["id"] for item in final.json()["circuits"]} == {
        "first-circuit",
        "concurrent-circuit",
    }


def test_legacy_migration_preserves_loads_with_missing_placements(world):
    alice, _, _, org = world
    headers = alice["h"]
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "Unresolved legacy load"},
        headers=headers,
    ).json()
    building = client.post(
        f"/api/v1/projects/{project['id']}/buildings",
        json={"name": "Main", "floors": [{"name": "Ground"}]},
        headers=headers,
    ).json()
    floor_id = building["floors"][0]["id"]
    unresolved_id = "source-load-not-on-floor"
    with SessionLocal() as db:
        floor = db.get(Floor, floor_id)
        floor.plan_data = {
            "placements": [],
            "rcds": [
                {
                    "id": "legacy-protection",
                    "name": "RCD",
                    "rated_current_ma": 30,
                    "poles": 4,
                    "type": "A",
                }
            ],
            "circuits": [
                {
                    "id": "legacy-circuit",
                    "name": "Legacy circuit",
                    "rcd_id": "legacy-protection",
                    "breaker_type": "B",
                    "rated_current_a": 10,
                    "poles": 1,
                    "cable": "3×1.5 mm²",
                    "supply": "1n",
                    "loads": [unresolved_id],
                }
            ],
        }
        db.commit()

    plan_url = f"/api/v1/projects/{project['id']}/floors/{floor_id}/plan"
    migrated_plan = client.get(plan_url, headers=headers)
    assert migrated_plan.status_code == 200, migrated_plan.text
    assert "unresolved" in migrated_plan.headers.get("X-Topology-Warnings", "").lower()
    board = client.get(f"/api/v1/projects/{project['id']}/boards", headers=headers).json()[0]
    circuit = client.get(
        f"/api/v1/projects/{project['id']}/boards/{board['id']}/circuits",
        headers=headers,
    ).json()[0]
    loads_url = f"/api/v1/projects/{project['id']}/circuits/{circuit['id']}/loads"
    migrated_loads = client.get(loads_url, headers=headers)
    assert migrated_loads.status_code == 200, migrated_loads.text
    assert migrated_loads.json() == [
        {
            "id": migrated_loads.json()[0]["id"],
            "circuit_id": circuit["id"],
            "name": unresolved_id,
            "floor_id": None,
            "placement_id": unresolved_id,
            "data": {},
        }
    ]

    exported = client.get(f"/api/v1/projects/{project['id']}/export", headers=headers)
    assert exported.status_code == 200, exported.text
    exported_load = exported.json()["topology"]["boards"][0]["circuits"][0]["loads"][0]
    assert exported_load["placement_id"] == unresolved_id
    assert exported_load["floor_ref"] is None
    imported = client.post(
        "/api/v1/projects/import",
        json={
            "organization_id": org["id"],
            "name": "Imported unresolved load",
            **exported.json(),
        },
        headers=headers,
    )
    assert imported.status_code == 201, imported.text
    imported_board = client.get(
        f"/api/v1/projects/{imported.json()['id']}/boards", headers=headers
    ).json()[0]
    imported_circuit = client.get(
        f"/api/v1/projects/{imported.json()['id']}/boards/{imported_board['id']}/circuits",
        headers=headers,
    ).json()[0]
    imported_loads = client.get(
        f"/api/v1/projects/{imported.json()['id']}/circuits/{imported_circuit['id']}/loads",
        headers=headers,
    )
    assert imported_loads.status_code == 200, imported_loads.text
    assert imported_loads.json()[0]["placement_id"] == unresolved_id
    assert imported_loads.json()[0]["floor_id"] is None


def _seed_legacy_floor(project_id, floor_id):
    with SessionLocal() as db:
        floor = db.get(Floor, floor_id)
        floor.plan_data = {
            "placements": [
                {
                    "id": "legacy-light",
                    "kind": "light",
                    "label": "Light",
                    "x": 5,
                    "y": 5,
                }
            ],
            "rcds": [
                {
                    "id": "legacy-rcd",
                    "name": "RCD",
                    "rated_current_ma": 30,
                    "poles": 4,
                    "type": "A",
                }
            ],
            "circuits": [
                {
                    "id": "legacy-circuit",
                    "name": "Legacy",
                    "rcd_id": "legacy-rcd",
                    "breaker_type": "B",
                    "rated_current_a": 10,
                    "poles": 1,
                    "cable": "3×1.5 mm²",
                    "supply": "1n",
                    "loads": ["legacy-light", "legacy-unresolved"],
                }
            ],
        }
        db.commit()


def _legacy_project(world, name):
    alice, _, _, org = world
    headers = alice["h"]
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": name},
        headers=headers,
    ).json()
    building = client.post(
        f"/api/v1/projects/{project['id']}/buildings",
        json={"name": "Main", "floors": [{"name": "Ground"}]},
        headers=headers,
    ).json()
    floor_id = building["floors"][0]["id"]
    _seed_legacy_floor(project["id"], floor_id)
    return headers, project["id"], building["id"], floor_id


def test_concurrent_legacy_migration_runs_exactly_once(world):
    from concurrent.futures import ThreadPoolExecutor

    headers, project_id, _, floor_id = _legacy_project(world, "Concurrent migration")
    plan_url = f"/api/v1/projects/{project_id}/floors/{floor_id}/plan"
    workers = [TestClient(app) for _ in range(6)]
    with ThreadPoolExecutor(max_workers=6) as pool:
        responses = list(pool.map(lambda worker: worker.get(plan_url, headers=headers), workers))
    assert [response.status_code for response in responses] == [200] * 6
    boards_response = client.get(f"/api/v1/projects/{project_id}/boards", headers=headers)
    boards = boards_response.json()
    assert len(boards) == 1
    circuits = client.get(
        f"/api/v1/projects/{project_id}/boards/{boards[0]['id']}/circuits",
        headers=headers,
    ).json()
    assert [row["source_id"] for row in circuits] == ["legacy-circuit"]
    loads = client.get(
        f"/api/v1/projects/{project_id}/circuits/{circuits[0]['id']}/loads",
        headers=headers,
    ).json()
    assert sorted(row["placement_id"] for row in loads) == [
        "legacy-light",
        "legacy-unresolved",
    ]
    assert len({response.json()["topology_revision"] for response in responses}) == 1


def test_boards_get_migrates_legacy_topology_before_listing(world):
    headers, project_id, _, floor_id = _legacy_project(world, "Boards migrate")
    response = client.get(f"/api/v1/projects/{project_id}/boards", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) == 1
    revision = int(response.headers["X-Topology-Revision"])
    plan = client.get(f"/api/v1/projects/{project_id}/floors/{floor_id}/plan", headers=headers)
    assert plan.json()["topology_revision"] == revision


def test_floor_delete_and_duplicate_invalidate_stale_plan_revision(world):
    headers, project_id, building_id, floor_id = _legacy_project(world, "Floor ops")
    plan_url = f"/api/v1/projects/{project_id}/floors/{floor_id}/plan"
    other = client.post(
        f"/api/v1/projects/{project_id}/buildings/{building_id}/floors",
        json={"name": "Upper"},
        headers=headers,
    ).json()
    other_url = f"/api/v1/projects/{project_id}/floors/{other['id']}/plan"

    stale = client.get(other_url, headers=headers)
    duplicated = client.post(
        f"/api/v1/projects/{project_id}/floors/{floor_id}/duplicate", headers=headers
    )
    assert duplicated.status_code == 201, duplicated.text
    assert client.put(other_url, json=stale.json(), headers=headers).status_code == 409

    stale = client.get(other_url, headers=headers)
    deleted = client.delete(
        f"/api/v1/projects/{project_id}/floors/{duplicated.json()['id']}",
        headers=headers,
    )
    assert deleted.status_code == 204
    assert client.put(other_url, json=stale.json(), headers=headers).status_code == 409

    stale = client.get(plan_url, headers=headers)
    assert (
        client.delete(
            f"/api/v1/projects/{project_id}/buildings/{building_id}", headers=headers
        ).status_code
        == 204
    )
    assert client.put(plan_url, json=stale.json(), headers=headers).status_code == 404


def test_floor_plan_save_does_not_overwrite_board_cabinet(world):
    alice, _, _, org = world
    headers = alice["h"]
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "Separate cabinets"},
        headers=headers,
    ).json()
    building = client.post(
        f"/api/v1/projects/{project['id']}/buildings",
        json={"name": "Main", "floors": [{"name": "Ground"}]},
        headers=headers,
    ).json()
    floor_id = building["floors"][0]["id"]
    boards_url = f"/api/v1/projects/{project['id']}/boards"
    board_data = {
        "cabinet": {
            "name": "Panel-specific cabinet",
            "manufacturer": "Example",
            "model": "Board model",
        }
    }
    board = client.post(
        boards_url,
        json={"name": "Panel", "floor_id": floor_id, "data": board_data},
        headers=headers,
    )
    assert board.status_code == 201, board.text

    plan_url = f"/api/v1/projects/{project['id']}/floors/{floor_id}/plan"
    plan = client.get(plan_url, headers=headers)
    assert plan.status_code == 200, plan.text
    edited = plan.json()
    edited["placements"] = [
        {
            "id": "unrelated-symbol",
            "kind": "light",
            "label": "Unrelated symbol",
            "x": 20,
            "y": 30,
        }
    ]
    saved = client.put(plan_url, json=edited, headers=headers)
    assert saved.status_code == 200, saved.text

    persisted_board = client.get(boards_url, headers=headers).json()[0]
    assert persisted_board["data"] == board_data
    assert saved.json()["cabinet"]["name"] != "Panel-specific cabinet"


def test_plan_revision_rejects_stale_same_circuit_and_allows_current_delete(world):
    alice, _, _, org = world
    headers = alice["h"]
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "Revision guarded plan"},
        headers=headers,
    ).json()
    building = client.post(
        f"/api/v1/projects/{project['id']}/buildings",
        json={"name": "Main", "floors": [{"name": "Ground"}]},
        headers=headers,
    ).json()
    floor_id = building["floors"][0]["id"]
    plan_url = f"/api/v1/projects/{project['id']}/floors/{floor_id}/plan"
    revision_required = TestClient(app).post(
        f"/api/v1/projects/{project['id']}/boards",
        json={"name": "No revision", "floor_id": floor_id},
        headers=headers,
    )
    assert revision_required.status_code == 428, revision_required.text
    initial = {
        "placements": [
            {
                "id": "revision-light",
                "kind": "light",
                "label": "Light",
                "x": 20,
                "y": 30,
            }
        ],
        "rcds": [
            {
                "id": "revision-rcd",
                "name": "RCD",
                "rated_current_ma": 30,
                "poles": 4,
                "type": "A",
            }
        ],
        "circuits": [
            {
                "id": "revision-circuit",
                "name": "Lighting",
                "rcd_id": "revision-rcd",
                "breaker_type": "B",
                "rated_current_a": 10,
                "poles": 1,
                "cable": "3×1.5 mm²",
                "supply": "1n",
                "loads": ["revision-light"],
            },
            {
                "id": "revision-circuit-two",
                "name": "Spare circuit",
                "rcd_id": "revision-rcd",
                "breaker_type": "B",
                "rated_current_a": 10,
                "poles": 1,
                "cable": "3×1.5 mm²",
                "supply": "1n",
                "loads": [],
            },
        ],
    }
    created = client.put(plan_url, json=initial, headers=headers)
    assert created.status_code == 200, created.text
    topology_board = client.get(f"/api/v1/projects/{project['id']}/boards", headers=headers).json()[
        0
    ]
    assert topology_board["data"].get("rcds", []), topology_board
    topology_circuits_at_save = client.get(
        f"/api/v1/projects/{project['id']}/boards/{topology_board['id']}/circuits",
        headers=headers,
    ).json()
    assert {row["id"] for row in topology_board["data"]["rcds"]} == {"revision-rcd"}
    assert {row["data"].get("rcd_id") for row in topology_circuits_at_save} == {"revision-rcd"}
    board_id = client.get(f"/api/v1/projects/{project['id']}/boards", headers=headers).json()[0][
        "id"
    ]
    board_url = f"/api/v1/projects/{project['id']}/boards/{board_id}"
    stale_revision = str(created.json()["topology_revision"])
    board_update_headers = {**headers, "If-Match": stale_revision}
    board_updated = client.put(
        board_url,
        json={
            "name": "Panel",
            "kind": "main",
            "floor_id": floor_id,
            "data": topology_board["data"],
        },
        headers=board_update_headers,
    )
    assert board_updated.status_code == 200, board_updated.text
    assert board_updated.headers["X-Topology-Revision"] == str(int(stale_revision) + 1)
    stale_board_update = client.put(
        board_url,
        json={
            "name": "Stale panel write",
            "kind": "main",
            "floor_id": floor_id,
            "data": topology_board["data"],
        },
        headers=board_update_headers,
    )
    assert stale_board_update.status_code == 409, stale_board_update.text
    editor_one_response = client.get(plan_url, headers=headers)
    editor_one = editor_one_response.json()
    assert editor_one["circuits"], (
        editor_one_response.headers.get("X-Topology-Warnings"),
        topology_board,
        topology_circuits_at_save,
    )
    editor_two = client.get(plan_url, headers=headers).json()
    editor_one["circuits"][0]["name"] = "Updated by editor one"
    first_save = client.put(plan_url, json=editor_one, headers=headers)
    assert first_save.status_code == 200, first_save.text
    editor_two["circuits"][0]["name"] = "Stale editor overwrite"
    stale_save = client.put(plan_url, json=editor_two, headers=headers)
    assert stale_save.status_code == 409, stale_save.text

    current = client.get(plan_url, headers=headers).json()
    current["circuits"][0]["loads"] = []
    current["circuits"][1]["loads"] = ["revision-light"]
    current["placements"][0]["circuit_id"] = "revision-circuit-two"
    moved = client.put(plan_url, json=current, headers=headers)
    assert moved.status_code == 200, moved.text
    board_id = client.get(f"/api/v1/projects/{project['id']}/boards", headers=headers).json()[0][
        "id"
    ]
    topology_circuits = client.get(
        f"/api/v1/projects/{project['id']}/boards/{board_id}/circuits",
        headers=headers,
    )
    assert topology_circuits.status_code == 200
    second_loads_url = (
        f"/api/v1/projects/{project['id']}/circuits/{topology_circuits.json()[1]['id']}/loads"
    )
    assert [
        row["placement_id"] for row in client.get(second_loads_url, headers=headers).json()
    ] == ["revision-light"]

    current = moved.json()
    current["circuits"][1]["loads"] = []
    current["placements"][0]["circuit_id"] = None
    unassigned = client.put(plan_url, json=current, headers=headers)
    assert unassigned.status_code == 200, unassigned.text
    assert client.get(second_loads_url, headers=headers).json() == []

    board_id = client.get(f"/api/v1/projects/{project['id']}/boards", headers=headers).json()[0][
        "id"
    ]
    topology_circuits = client.get(
        f"/api/v1/projects/{project['id']}/boards/{board_id}/circuits",
        headers=headers,
    ).json()
    manual = client.post(
        f"/api/v1/projects/{project['id']}/circuits/{topology_circuits[0]['id']}/loads",
        json={"name": "Manual load"},
        headers=headers,
    )
    assert manual.status_code == 201, manual.text

    current = client.get(plan_url, headers=headers).json()
    current["rcds"] = []
    current["circuits"] = []
    current["placements"][0]["circuit_id"] = None
    blocked_delete = client.put(plan_url, json=current, headers=headers)
    assert blocked_delete.status_code == 409, blocked_delete.text
    assert (
        client.get(
            f"/api/v1/projects/{project['id']}/circuits/{topology_circuits[0]['id']}/loads",
            headers=headers,
        ).json()[0]["name"]
        == "Manual load"
    )
    assert (
        client.delete(
            f"/api/v1/projects/{project['id']}/loads/{manual.json()['id']}",
            headers=headers,
        ).status_code
        == 204
    )
    current = client.get(plan_url, headers=headers).json()
    current["rcds"] = []
    current["circuits"] = []
    current["placements"][0]["circuit_id"] = None
    deleted = client.put(plan_url, json=current, headers=headers)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["rcds"] == []
    assert deleted.json()["circuits"] == []
    assert (
        client.get(f"/api/v1/projects/{project['id']}/boards", headers=headers)
        .json()[0]["data"]
        .get("rcds", [])
        == []
    )


def test_topology_revision_headers_cover_reads_deletes_and_cors(world):
    alice, _, _, org = world
    headers = {**alice["h"], "Origin": "http://localhost:8080"}
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "Topology revision headers"},
        headers=headers,
    ).json()
    project_id = project["id"]
    boards_url = f"/api/v1/projects/{project_id}/boards"

    board = client.post(boards_url, json={"name": "Main", "kind": "main"}, headers=headers)
    assert board.status_code == 201, board.text
    board_id = board.json()["id"]
    assert board.headers["X-Topology-Revision"]
    assert "x-topology-revision" in board.headers["Access-Control-Expose-Headers"].lower()

    circuit_url = f"{boards_url}/{board_id}/circuits"
    circuit = client.post(
        circuit_url,
        json={"name": "Circuit"},
        headers=headers,
    )
    assert circuit.status_code == 201, circuit.text
    circuit_id = circuit.json()["id"]
    loads_url = f"/api/v1/projects/{project_id}/circuits/{circuit_id}/loads"
    load = client.post(loads_url, json={"name": "Manual load"}, headers=headers)
    assert load.status_code == 201, load.text

    board_list = client.get(boards_url, headers=headers)
    circuits = client.get(circuit_url, headers=headers)
    loads = client.get(loads_url, headers=headers)
    assert [board_list.status_code, circuits.status_code, loads.status_code] == [
        200,
        200,
        200,
    ]
    snapshot_revisions = {
        board_list.headers["X-Topology-Revision"],
        circuits.headers["X-Topology-Revision"],
        loads.headers["X-Topology-Revision"],
    }
    assert len(snapshot_revisions) == 1
    revision = int(snapshot_revisions.pop())

    delete_load = client.delete(
        f"/api/v1/projects/{project_id}/loads/{load.json()['id']}", headers=headers
    )
    assert delete_load.status_code == 204
    assert delete_load.headers["X-Topology-Revision"] == str(revision + 1)
    delete_circuit = client.delete(
        f"/api/v1/projects/{project_id}/circuits/{circuit_id}", headers=headers
    )
    assert delete_circuit.status_code == 204
    assert delete_circuit.headers["X-Topology-Revision"] == str(revision + 2)
    delete_board = client.delete(f"{boards_url}/{board_id}", headers=headers)
    assert delete_board.status_code == 204
    assert delete_board.headers["X-Topology-Revision"] == str(revision + 3)


def test_incomplete_api_topology_is_not_rendered_as_fake_electrical_data(world):
    alice, _, _, org = world
    headers = alice["h"]
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "Incomplete topology"},
        headers=headers,
    ).json()
    building = client.post(
        f"/api/v1/projects/{project['id']}/buildings",
        json={"name": "Main", "floors": [{"name": "Ground"}]},
        headers=headers,
    ).json()
    floor_id = building["floors"][0]["id"]
    board = client.post(
        f"/api/v1/projects/{project['id']}/boards",
        json={"name": "Unspecified board", "kind": "main", "floor_id": floor_id},
        headers=headers,
    )
    assert board.status_code == 201, board.text
    circuit = client.post(
        f"/api/v1/projects/{project['id']}/boards/{board.json()['id']}/circuits",
        json={"name": "Unspecified circuit"},
        headers=headers,
    )
    assert circuit.status_code == 201, circuit.text
    response = client.get(
        f"/api/v1/projects/{project['id']}/floors/{floor_id}/plan", headers=headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["rcds"] == []
    assert response.json()["circuits"] == []
    assert "incomplete schematic data" in response.headers["x-topology-warnings"]
    exported = client.get(f"/api/v1/projects/{project['id']}/export", headers=headers)
    assert exported.status_code == 200, exported.text
    raw_circuit = exported.json()["topology"]["boards"][0]["circuits"][0]
    assert raw_circuit["data"] == {}


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
    assert (
        client.get(
            f"/api/v1/projects/{duplicated.json()['id']}/floors/{copied_floor}/plan",
            headers=headers,
        ).json()["rooms"][0]["name"]
        == "Hall"
    )

    exported = client.get(f"/api/v1/projects/{project['id']}/export", headers=headers)
    assert exported.status_code == 200
    imported = client.post(
        "/api/v1/projects/import",
        json={
            "organization_id": org["id"],
            "name": "Imported Villa",
            **exported.json(),
        },
        headers=headers,
    )
    assert imported.status_code == 201, imported.text

    copied_floor_response = client.post(
        f"/api/v1/projects/{project['id']}/floors/{floor_id}/duplicate", headers=headers
    )
    assert copied_floor_response.status_code == 201
    new_floor_id = copied_floor_response.json()["id"]
    assert (
        client.get(
            f"/api/v1/projects/{project['id']}/floors/{new_floor_id}/plan",
            headers=headers,
        ).json()["rooms"][0]["name"]
        == "Hall"
    )
    assert (
        client.patch(
            f"/api/v1/projects/{project['id']}/floors/{new_floor_id}",
            json={"name": "First floor"},
            headers=headers,
        ).json()["name"]
        == "First floor"
    )
    assert (
        client.delete(
            f"/api/v1/projects/{project['id']}/floors/{new_floor_id}", headers=headers
        ).status_code
        == 204
    )

    archived = client.patch(
        f"/api/v1/projects/{project['id']}", json={"archived": True}, headers=headers
    )
    assert archived.json()["archived"] is True
    assert project["id"] not in [
        item["id"] for item in client.get("/api/v1/projects", headers=headers).json()
    ]
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
            {
                "id": "room",
                "name": "Living room",
                "x": 10,
                "y": 10,
                "width": 100,
                "height": 80,
                "layer_id": "client",
            }
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
            {
                "id": "private-load",
                "kind": "switch",
                "label": "Internal circuit",
                "x": 35,
                "y": 35,
                "layer_id": "technical",
            },
        ],
        "smart_devices": [
            {
                "id": "device-1",
                "name": "KNX actuator",
                "system": "knx",
                "kind": "actuator",
                "channels": [
                    {
                        "id": "channel-1",
                        "name": "Output 1",
                        "kind": "switching",
                        "load_ids": ["public-load"],
                    }
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
    assert (
        client.delete(
            f"/api/v1/projects/{project['id']}/shares/{created.json()['id']}",
            headers=alice["h"],
        ).status_code
        == 204
    )
    assert (
        client.get(shared_url, headers={"X-Share-Password": "client-password"}).status_code == 404
    )


def test_team_visibility(world):
    alice, bob, eve, org = world
    team = client.post(
        f"/api/v1/organizations/{org['id']}/teams",
        json={"name": "Core"},
        headers=alice["h"],
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
        f"/api/v1/organizations/{org['id']}/teams",
        json={"name": "Core"},
        headers=alice["h"],
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
    r = client.delete(
        f"/api/v1/organizations/{org['id']}/members/{alice['id']}", headers=alice["h"]
    )
    assert r.status_code == 400
