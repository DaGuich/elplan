"""Integration tests for the OAuth callback; the provider is mocked at the service boundary."""
import uuid
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services import oauth

client = TestClient(app, follow_redirects=False)


@pytest.fixture(autouse=True)
def provider(monkeypatch):
    monkeypatch.setattr(settings, "OAUTH_CLIENT_ID", "cid")
    monkeypatch.setattr(oauth, "_cache", oauth.Endpoints("https://idp", "https://idp/auth", "https://idp/token", "https://idp/info"))
    state = {"info": {}}
    monkeypatch.setattr(oauth, "exchange_code", lambda code, verifier: "at")
    monkeypatch.setattr(oauth, "fetch_userinfo", lambda at: state["info"])
    return state


def start_login():
    r = client.get("/api/v1/auth/oauth/login")
    assert r.status_code == 302
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert q["code_challenge_method"] == ["S256"] and q["client_id"] == ["cid"]
    return q["state"][0]


def finish(state):
    r = client.get(f"/api/v1/auth/oauth/callback?code=abc&state={state}")
    assert r.status_code == 303
    return r.headers["location"].split("#", 1)[1]


def test_login_provisions_user_and_token_works(provider):
    email = f"sso-{uuid.uuid4().hex[:8]}@example.com"
    provider["info"] = {"sub": uuid.uuid4().hex, "email": email, "name": "Sso User"}
    frag = finish(start_login())
    assert frag.startswith("token=")
    me = client.get("/api/v1/users/me", headers={"Authorization": "Bearer " + frag[6:]})
    assert me.json()["email"] == email
    # password login is impossible for OAuth-only accounts
    assert client.post("/api/v1/auth/login", json={"email": email, "password": "!"}).status_code == 401


def test_state_mismatch_rejected(provider):
    start_login()
    assert finish("wrong").startswith("error=")


def test_existing_local_account_is_never_auto_linked(provider):
    email = f"loc-{uuid.uuid4().hex[:8]}@example.com"
    client.post("/api/v1/auth/register", json={"email": email, "name": "L", "password": "password123"})
    provider["info"] = {"sub": uuid.uuid4().hex, "email": email, "email_verified": False}
    assert finish(start_login()).startswith("error=")
    provider["info"]["email_verified"] = True
    assert finish(start_login()).startswith("error=")
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert login.status_code == 200
