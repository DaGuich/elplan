import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def test_topology_warning_header_is_exposed_to_configured_origins():
    origins = [origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()]
    if not origins:
        pytest.skip("No CORS origins configured")
    response = TestClient(app).get("/openapi.json", headers={"Origin": origins[0]})
    assert response.status_code == 200
    assert "x-topology-warnings" in response.headers["access-control-expose-headers"].lower()
