"""Admin user management routes (/api/v1/admin/users*)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.deps import require_admin
from app.auth.sessions import generate_token, hash_token
from app.config import settings
from app.database import db
from app.schemas.auth import (
    AdminCreateUserRequest,
    AdminCreateUserResponse,
    AdminPatchUserRequest,
    AdminResetLinkResponse,
    UserResponse,
)

router = APIRouter(prefix="/admin/users", tags=["admin_users"])


@router.get("", response_model=list[UserResponse])
async def list_users(
    _admin: dict[str, Any] = Depends(require_admin),
) -> Any:
    """List all registered users (admin only)."""
    users = await db.list_users()
    return [UserResponse(**u) for u in users]


@router.post("", response_model=AdminCreateUserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: AdminCreateUserRequest,
    _admin: dict[str, Any] = Depends(require_admin),
) -> Any:
    """Create a new user and generate an initial invite link (admin only)."""
    existing = await db.get_user_by_email(payload.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists.",
        )

    user_id = str(uuid4())
    daily_ai_limit = payload.daily_ai_limit
    if daily_ai_limit is None and payload.role != "admin":
        daily_ai_limit = settings.default_daily_ai_limit

    user = await db.create_user(
        id=user_id,
        email=payload.email,
        display_name=payload.display_name,
        role=payload.role,
        daily_ai_limit=daily_ai_limit,
        is_active=True,
        password_hash=None,
    )

    token = generate_token()
    token_hash = hash_token(token)
    expires_at = (
        datetime.now(timezone.utc) + timedelta(days=settings.invite_ttl_days)
    ).isoformat()

    await db.create_invite(
        token_hash=token_hash,
        user_id=user["id"],
        purpose="invite",
        expires_at=expires_at,
    )

    return AdminCreateUserResponse(
        user=UserResponse(**user),
        invite_path=f"/invite/{token}",
    )


@router.post("/{user_id}/reset-link", response_model=AdminResetLinkResponse)
async def create_reset_link(
    user_id: str,
    _admin: dict[str, Any] = Depends(require_admin),
) -> Any:
    """Create a password-reset invite link and revoke active sessions for the user (admin only)."""
    user = await db.get_user(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    # Revoke sessions immediately
    await db.delete_user_sessions(user["id"])

    token = generate_token()
    token_hash = hash_token(token)
    expires_at = (
        datetime.now(timezone.utc) + timedelta(days=settings.invite_ttl_days)
    ).isoformat()

    await db.create_invite(
        token_hash=token_hash,
        user_id=user["id"],
        purpose="reset",
        expires_at=expires_at,
    )

    return AdminResetLinkResponse(invite_path=f"/invite/{token}")


@router.patch("/{user_id}", response_model=UserResponse)
async def patch_user(
    user_id: str,
    payload: AdminPatchUserRequest,
    _admin: dict[str, Any] = Depends(require_admin),
) -> Any:
    """Update user properties (deactivation also revokes active sessions)."""
    user = await db.get_user(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    updates: dict[str, Any] = {}
    if payload.display_name is not None:
        updates["display_name"] = payload.display_name

    if payload.daily_ai_limit is not None:
        updates["daily_ai_limit"] = payload.daily_ai_limit

    if payload.is_active is not None:
        if payload.is_active is False:
            # Check if this user is the last active admin
            if user["role"] == "admin":
                all_users = await db.list_users()
                active_admins = [
                    u for u in all_users if u["role"] == "admin" and u.get("is_active", False)
                ]
                if len(active_admins) <= 1 and any(u["id"] == user["id"] for u in active_admins):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Cannot deactivate the last active admin.",
                    )
            # Revoke sessions upon deactivation
            await db.delete_user_sessions(user["id"])
        updates["is_active"] = payload.is_active

    updated_user = await db.update_user(user["id"], **updates)
    return UserResponse(**(updated_user or user))
