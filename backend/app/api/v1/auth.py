import secrets
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.security import (
    create_access_token,
    create_state_token,
    decode_state_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.services import oauth
from app.schemas.auth import LoginRequest, Token, UserCreate, UserRead

router = APIRouter(tags=["auth"])


def _by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(func.lower(User.email) == email.lower()))


@router.post("/auth/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    if _by_email(db, payload.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(
        email=payload.email.lower(), name=payload.name, password_hash=hash_password(payload.password)
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/auth/login", response_model=Token)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = _by_email(db, payload.email)
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return Token(access_token=create_access_token(user.id))


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
