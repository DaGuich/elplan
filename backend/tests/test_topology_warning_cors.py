from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.responses import Response

from app.api.v1.projects import (
    MAX_TOPOLOGY_WARNINGS_HEADER_BYTES,
    TOPOLOGY_WARNINGS_TRUNCATED,
    _attach_topology_warnings,
)
from app.core.config import settings
from app.main import app
from app.services import topology


def test_topology_warning_header_is_exposed_to_configured_origins():
    origins = [origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()]
    if not origins:
        pytest.skip("No CORS origins configured")
    response = TestClient(app).get("/openapi.json", headers={"Origin": origins[0]})
    assert response.status_code == 200
    assert "x-topology-warnings" in response.headers["access-control-expose-headers"].lower()


def test_topology_warning_header_is_byte_bounded_and_reports_truncation():
    response = Response()
    data = {
        "topology_revision": 5,
        "topology_warnings": [f"Board {index}: " + "ä" * 200 for index in range(20)],
    }
    _attach_topology_warnings(response, data)
    header = response.headers["X-Topology-Warnings"]
    assert len(header.encode("ascii")) <= MAX_TOPOLOGY_WARNINGS_HEADER_BYTES
    assert TOPOLOGY_WARNINGS_TRUNCATED in header
    assert response.headers["X-Topology-Revision"] == "5"


@pytest.mark.parametrize("rcds", [None, [None]])
def test_malformed_topology_metadata_becomes_warnings(monkeypatch, rcds):
    board = SimpleNamespace(name="Board", data={"rcds": rcds})
    circuit = SimpleNamespace(
        name="Circuit",
        source_id="circuit-1",
        data={
            "rcd_id": [],
            "breaker_type": "B",
            "rated_current_a": 10,
            "poles": 1,
            "cable": "3x1.5",
            "supply": "1n",
        },
    )
    monkeypatch.setattr(topology, "list_boards", lambda *_: [board])
    monkeypatch.setattr(topology, "list_circuits", lambda *_: [circuit])
    monkeypatch.setattr(topology, "list_loads", lambda *_: [])

    rcds_result, circuits_result, warnings = topology.project_plan_topology(
        SimpleNamespace(scalars=lambda *_: []), SimpleNamespace(id=1)
    )

    assert rcds_result == []
    assert circuits_result == []
    assert any("RCD metadata is invalid" in warning for warning in warnings)
    assert any("invalid schematic data" in warning for warning in warnings)
