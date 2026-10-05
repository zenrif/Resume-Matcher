"""Authentication routes (/api/v1/auth/*)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse

from app.auth.deps import get_client_ip, require_user
from app.auth.passwords import dummy_verify, hash_password, verify_password
from app.auth.quota import current_jakarta_day
from app.auth.rate_limit import login_rate_limiter
from app.auth.sessions import COOKIE_NAME, generate_token, hash_token
from app.config import settings
from app.database import db
from app.schemas.auth import (
    AcceptInviteRequest,
    ChangePasswordRequest,
    InviteValidateResponse,
    LoginRequest,
    LoginResponse,
    UpdateProfileRequest,
    UserMeResponse,
    UserResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
) -> Any:
    """Authenticate user with email and password, setting an HttpOnly session cookie."""
    client_ip = get_client_ip(request)
    is_limited, retry_after = login_rate_limiter.is_rate_limited(client_ip, payload.email)
    if is_limited:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"detail": "Too many failed login attempts. Please try again later."},
            headers={"Retry-After": str(retry_after)},
        )

    user = await db.get_user_by_email(payload.email)
    if user is None or not user.get("password_hash"):
        dummy_verify()
        login_rate_limiter.record_failure(client_ip, payload.email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    if not verify_password(payload.password, user["password_hash"]):
        login_rate_limiter.record_failure(client_ip, payload.email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    if not user.get("is_active", False):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    token = generate_token()
    token_hash = hash_token(token)
    expires_at = (
        datetime.now(timezone.utc) + timedelta(days=settings.auth_session_days)
    ).isoformat()

    await db.create_session(token_hash=token_hash, user_id=user["id"], expires_at=expires_at)
    await db.update_user_last_login(user["id"])

    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=settings.auth_session_days * 86400,
        httponly=True,
        samesite="lax",
        path="/",
        secure=settings.auth_cookie_secure,
    )

    return LoginResponse(user=UserResponse(**user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    _user: dict[str, Any] = Depends(require_user),
) -> None:
    """Revoke the current session and clear the session cookie."""
    token = request.cookies.get(COOKIE_NAME)
    if token:
        await db.delete_session(hash_token(token))

    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.auth_cookie_secure,
    )


@router.get("/me", response_model=UserMeResponse)
async def me(
    user: dict[str, Any] = Depends(require_user),
) -> Any:
    """Return the profile of the current authenticated user."""
    today = current_jakarta_day()
    ai_used = await db.get_ai_usage_today(user_id=user["id"], day=today)
    return UserMeResponse(
        id=user["id"],
        email=user["email"],
        display_name=user["display_name"],
        role=user["role"],
        content_language=user.get("content_language", "id"),
        daily_ai_limit=user.get("daily_ai_limit"),
        ai_used_today=ai_used,
    )


@router.patch("/me", response_model=UserMeResponse)
async def update_profile(
    payload: UpdateProfileRequest,
    user: dict[str, Any] = Depends(require_user),
) -> Any:
    """Update the current authenticated user's display name."""
    updated = await db.update_user(user["id"], display_name=payload.display_name)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )
    today = current_jakarta_day()
    ai_used = await db.get_ai_usage_today(user_id=user["id"], day=today)
    return UserMeResponse(
        id=updated["id"],
        email=updated["email"],
        display_name=updated["display_name"],
        role=updated["role"],
        content_language=updated.get("content_language", "id"),
        daily_ai_limit=updated.get("daily_ai_limit"),
        ai_used_today=ai_used,
    )


@router.post("/password")
async def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, str]:
    """Change the user's password and revoke all other active sessions."""
    if len(payload.new_password) < settings.min_password_length:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Password must be at least {settings.min_password_length} characters.",
        )

    current_hash = user.get("password_hash")
    if not current_hash or not verify_password(payload.current_password, current_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect.",
        )

    new_hash = hash_password(payload.new_password)
    await db.update_user_password(user["id"], new_hash)

    # Revoke all other sessions for this user
    current_token = request.cookies.get(COOKIE_NAME)
    current_token_hash = hash_token(current_token) if current_token else None
    await db.delete_user_sessions(user["id"], except_token_hash=current_token_hash)

    return {"status": "password_updated"}


@router.get("/invite/{token}", response_model=InviteValidateResponse)
async def validate_invite(token: str) -> Any:
    """Validate an invite or password-reset token."""
    token_hash = hash_token(token)
    invite = await db.get_invite_by_token_hash(token_hash)
    if not invite or invite["used_at"] is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite link is invalid or has expired.",
        )

    try:
        expires_at = datetime.fromisoformat(invite["expires_at"])
        if expires_at <= datetime.now(timezone.utc):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Invite link is invalid or has expired.",
            )
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite link is invalid or has expired.",
        )

    user = await db.get_user(invite["user_id"])
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite link is invalid or has expired.",
        )

    return InviteValidateResponse(
        email=user["email"],
        display_name=user["display_name"],
        purpose=invite["purpose"],
    )


@router.post("/invite/{token}", response_model=LoginResponse)
async def accept_invite(
    token: str,
    payload: AcceptInviteRequest,
    request: Request,
    response: Response,
) -> Any:
    """Accept an invite or reset token, set the new password, and establish a session."""
    client_ip = get_client_ip(request)
    is_limited, retry_after = login_rate_limiter.is_rate_limited(client_ip, f"invite:{token[:8]}")
    if is_limited:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"detail": "Too many attempts. Please try again later."},
            headers={"Retry-After": str(retry_after)},
        )

    if len(payload.password) < settings.min_password_length:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Password must be at least {settings.min_password_length} characters.",
        )

    token_hash = hash_token(token)
    invite = await db.get_invite_by_token_hash(token_hash)
    if not invite or invite["used_at"] is not None:
        login_rate_limiter.record_failure(client_ip, f"invite:{token[:8]}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite link is invalid or has expired.",
        )

    try:
        expires_at = datetime.fromisoformat(invite["expires_at"])
        if expires_at <= datetime.now(timezone.utc):
            login_rate_limiter.record_failure(client_ip, f"invite:{token[:8]}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Invite link is invalid or has expired.",
            )
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite link is invalid or has expired.",
        )

    user = await db.get_user(invite["user_id"])
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite link is invalid or has expired.",
        )

    # Mark invite used
    await db.mark_invite_used(token_hash)

    # Set password and activate account
    pwd_hash = hash_password(payload.password)
    updated_user = await db.update_user(user["id"], password_hash=pwd_hash, is_active=True)

    # If purpose was password reset, revoke all prior sessions
    if invite["purpose"] == "reset":
        await db.delete_user_sessions(user["id"])

    # Create new session
    session_token = generate_token()
    session_hash = hash_token(session_token)
    session_expires = (
        datetime.now(timezone.utc) + timedelta(days=settings.auth_session_days)
    ).isoformat()

    await db.create_session(token_hash=session_hash, user_id=user["id"], expires_at=session_expires)
    await db.update_user_last_login(user["id"])

    response.set_cookie(
        key=COOKIE_NAME,
        value=session_token,
        max_age=settings.auth_session_days * 86400,
        httponly=True,
        samesite="lax",
        path="/",
        secure=settings.auth_cookie_secure,
    )

    return LoginResponse(user=UserResponse(**(updated_user or user)))
