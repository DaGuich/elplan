"""Back-channel OAuth2/OIDC client: the backend talks to the provider directly
(code exchange + userinfo), the browser only ever sees redirects."""
import base64
import hashlib
import secrets
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import UNUSABLE_PASSWORD
from app.models.identity import UserIdentity
from app.models.user import User

TIMEOUT = httpx.Timeout(10.0)


@dataclass
class Endpoints:
    issuer: str
    authorize: str
    token: str
    userinfo: str


_cache: Endpoints | None = None


def get_endpoints() -> Endpoints:
    global _cache
    if _cache is not None:
        return _cache
    meta: dict = {}
    if settings.OAUTH_DISCOVERY_URL:
        try:
            r = httpx.get(settings.OAUTH_DISCOVERY_URL, timeout=TIMEOUT)
            r.raise_for_status()
            meta = r.json()
        except (httpx.HTTPError, ValueError):
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "OAuth provider discovery failed")
    ep = Endpoints(
        issuer=meta.get("issuer") or settings.OAUTH_DISCOVERY_URL or settings.OAUTH_AUTHORIZE_URL,
        authorize=settings.OAUTH_AUTHORIZE_URL or meta.get("authorization_endpoint", ""),
        token=settings.OAUTH_TOKEN_URL or meta.get("token_endpoint", ""),
        userinfo=settings.OAUTH_USERINFO_URL or meta.get("userinfo_endpoint", ""),
    )
    if not (ep.authorize and ep.token and ep.userinfo):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "OAuth provider is misconfigured")
    _cache = ep
    return ep


def new_pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def authorization_url(state: str, code_challenge: str) -> str:
    query = urlencode(
        {
            "response_type": "code",
            "client_id": settings.OAUTH_CLIENT_ID,
            "redirect_uri": settings.OAUTH_REDIRECT_URI,
            "scope": settings.OAUTH_SCOPES,
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
    )
    return f"{get_endpoints().authorize}?{query}"


def exchange_code(code: str, code_verifier: str) -> str:
    """Back-channel call to the token endpoint; returns the access token."""
    try:
        r = httpx.post(
            get_endpoints().token,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.OAUTH_REDIRECT_URI,
                "client_id": settings.OAUTH_CLIENT_ID,
                "client_secret": settings.OAUTH_CLIENT_SECRET,
                "code_verifier": code_verifier,
            },
            headers={"Accept": "application/json"},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        return r.json()["access_token"]
    except (httpx.HTTPError, ValueError, KeyError):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "OAuth token exchange failed")


def fetch_userinfo(access_token: str) -> dict:
    try:
        r = httpx.get(
            get_endpoints().userinfo,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        info = r.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "OAuth userinfo request failed")
    if not isinstance(info, dict) or not info.get("sub"):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "OAuth userinfo missing subject")
    return info


def resolve_user(db: Session, info: dict) -> User:
    """Find the user for an external identity, linking or provisioning as needed."""
    issuer = get_endpoints().issuer
    subject = str(info["sub"])
    identity = db.scalar(
        select(UserIdentity).where(UserIdentity.issuer == issuer, UserIdentity.subject == subject)
    )
    if identity is not None:
        user = db.get(User, identity.user_id)
        if user is None or not user.is_active:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
        return user

    email = (info.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Provider did not return an email address")

    user = db.scalar(select(User).where(func.lower(User.email) == email))
    if user is not None:
        if not settings.OAUTH_TRUST_EMAIL:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Email already registered; sign in with the existing account",
            )
        if not user.is_active:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    else:
        name = info.get("name") or info.get("preferred_username") or email
        user = User(email=email, name=str(name)[:200], password_hash=UNUSABLE_PASSWORD)
        db.add(user)
        db.flush()
    db.add(UserIdentity(user_id=user.id, issuer=issuer, subject=subject))
    db.commit()
    db.refresh(user)
    return user
