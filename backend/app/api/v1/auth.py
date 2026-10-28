import secrets
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.security import (
    create_access_token,
    create_state_token,
    decode_state_token,
)
from app.models.user import User
from app.schemas.auth import UserRead
from app.services import oauth

router = APIRouter(tags=["auth"])


@router.post("/auth/register")
def register_disabled():
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        "Password registration is disabled; use the identity provider",
    )


@router.post("/auth/login")
def login_disabled():
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        "Password login is disabled; use the identity provider",
    )


@router.get("/users/me", response_model=UserRead)
def me(user: User = Depends(get_current_user)):
    return user


STATE_COOKIE = "oauth_state"


@router.get("/auth/config")
def auth_config():
    return {
        "oauth_enabled": settings.oauth_enabled,
        "oauth_provider_name": settings.OAUTH_PROVIDER_NAME,
    }


def _require_oauth() -> None:
    if not settings.oauth_enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OAuth login is not enabled")


def _frontend_redirect(fragment: str) -> RedirectResponse:
    resp = RedirectResponse(f"{settings.FRONTEND_URL.rstrip('/')}/#{fragment}", status.HTTP_303_SEE_OTHER)
    resp.delete_cookie(STATE_COOKIE, path="/api/v1/auth/oauth")
    return resp


@router.get("/auth/oauth/login")
def oauth_login():
    _require_oauth()
    state = secrets.token_urlsafe(32)
    verifier, challenge = oauth.new_pkce()
    resp = RedirectResponse(oauth.authorization_url(state, challenge), status.HTTP_302_FOUND)
    resp.set_cookie(
        STATE_COOKIE,
        create_state_token(state, verifier),
        max_age=600,
        httponly=True,
        samesite="lax",
        secure=settings.OAUTH_REDIRECT_URI.startswith("https://"),
        path="/api/v1/auth/oauth",
    )
    return resp


@router.get("/auth/oauth/callback")
def oauth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    _require_oauth()
    if error or not code or not state:
        return _frontend_redirect("error=" + quote(error or "oauth_failed"))
    saved = decode_state_token(request.cookies.get(STATE_COOKIE, ""))
    if saved is None or not secrets.compare_digest(saved["state"], state):
        return _frontend_redirect("error=invalid_state")
    try:
        access_token = oauth.exchange_code(code, saved["verifier"])
        user = oauth.resolve_user(db, oauth.fetch_userinfo(access_token))
    except HTTPException as exc:
        return _frontend_redirect("error=" + quote(str(exc.detail)))
    return _frontend_redirect("token=" + create_access_token(user.id))
