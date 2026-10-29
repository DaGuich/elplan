"""Integration tests; require DATABASE_URL pointing at a migrated database."""

from fastapi.testclient import TestClient

from app.main import app
from tests.test_access import make_user

client = TestClient(app)

DETAILS = {
    "status": "quoted",
    "project_number": " P-2024-7 ",
    "client_name": "  Erika Mustermann ",
    "client_email": "erika@example.com",
    "site_city": "Berlin",
    "nominal_voltage_v": 400,
    "phases": 3,
    "grid_system": "TT",
    "main_fuse_a": 63,
    "currency": "EUR",
    "vat_percent": 7,
    "pricing_templates": [{"name": "Socket", "unit": "piece", "unit_price": 12.5}],
}


def make_project():
    alice, eve = make_user("alice"), make_user("eve")
    org = client.post("/api/v1/organizations", json={"name": "Acme"}, headers=alice["h"]).json()
    project = client.post(
        "/api/v1/projects",
        json={"organization_id": org["id"], "name": "P"},
        headers=alice["h"],
    ).json()
    return alice, eve, org, project


def test_defaults_roundtrip_and_access():
    alice, eve, _, project = make_project()
    url = f"/api/v1/projects/{project['id']}/details"
    r = client.get(url, headers=alice["h"])
    assert (
        r.json()["grid_system"] is None
        and r.json()["phases"] is None
        and r.json()["vat_percent"] is None
    )
    assert (
        r.status_code == 200
        and r.json()["status"] == "planning"
        and r.json()["nominal_voltage_v"] is None
    )
    assert client.put(url, json=DETAILS, headers=alice["h"]).status_code == 200
    body = client.get(url, headers=alice["h"]).json()
    assert body["project_number"] == "P-2024-7"
    assert body["client_name"] == "Erika Mustermann" and body["grid_system"] == "TT"
    assert body["pricing_templates"][0]["unit_price"] == 12.5
    assert client.get(url, headers=eve["h"]).status_code == 404
    assert client.put(url, json=DETAILS, headers=eve["h"]).status_code == 404
    assert client.get(url).status_code == 401


def test_validation():
    alice, _, _, project = make_project()
    url = f"/api/v1/projects/{project['id']}/details"
    for bad in (
        {"status": "nope"},
        {"phases": 2},
        {"client_email": "not-mail"},
        {"vat_percent": -1},
        {"currency": "euro"},
        {"pricing_templates": [{"name": "x", "unit_price": -1}]},
    ):
        assert client.put(url, json=bad, headers=alice["h"]).status_code == 422, bad


def test_export_import_and_duplicate_keep_details():
    alice, _, org, project = make_project()
    base = f"/api/v1/projects/{project['id']}"
    client.put(f"{base}/details", json=DETAILS, headers=alice["h"])
    exported = client.get(f"{base}/export", headers=alice["h"]).json()
    assert exported["details"]["client_email"] == "erika@example.com"

    dup = client.post(f"{base}/duplicate", headers=alice["h"]).json()
    copied = client.get(f"/api/v1/projects/{dup['id']}/details", headers=alice["h"]).json()
    assert copied["grid_system"] == "TT" and copied["nominal_voltage_v"] == 400
    assert copied["project_number"] == "P-2024-7"
    assert copied["status"] == "quoted" and copied["pricing_templates"][0]["name"] == "Socket"

    imported = client.post(
        "/api/v1/projects/import",
        json={**exported, "organization_id": org["id"]},
        headers=alice["h"],
    ).json()
    again = client.get(f"/api/v1/projects/{imported['id']}/details", headers=alice["h"]).json()
    assert again["project_number"] == "P-2024-7" and again["client_name"] == "Erika Mustermann"
    assert again["main_fuse_a"] == 63 and again["site_city"] == "Berlin"

    legacy = client.post(
        "/api/v1/projects/import",
        json={"organization_id": org["id"], "name": "Old", "buildings": []},
        headers=alice["h"],
    ).json()
    assert (
        client.get(f"/api/v1/projects/{legacy['id']}/details", headers=alice["h"]).json()["status"]
        == "planning"
    )
    shared = client.post(f"{base}/shares", json={}, headers=alice["h"]).json()
    public = client.get(f"/api/v1/projects/shared/{shared['token']}").json()
    assert "details" not in public and "client_email" not in str(public)
