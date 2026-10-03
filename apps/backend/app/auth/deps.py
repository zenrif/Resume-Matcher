"""FastAPI dependencies for authentication, role gating, and client IP resolution."""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import Depends, HTTPException, Request, status

from app.auth.context import current_user_id
from app.auth.sessions import COOKIE_NAME, hash_token
from app.config import settings
from app.database import db


def get_client_ip(request: Request) -> str:
    """Resolve the client IP address, honoring trust_proxy configuration."""
    if settings.trust_proxy:
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            # The left-most address represents the original client
            parts = [p.strip() for p in forwarded_for.split(",")]
            if parts and parts[0]:
                return parts[0]

    if request.client and request.client.host:
        return request.client.host
    return "127.0.0.1"


async def get_current_user(request: Request) -> dict[str, Any]:
    """Extract and validate the session cookie, setting the request-scoped user context.

    MUST be an async def dependency to run directly on the event loop, ensuring
    ``current_user_id.set()`` modifies the active request context.
    """
    token = request.cookies.get(COOKIE_NAME)
    if not token or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
        )

    token_hash = hash_token(token)
    session = await db.get_session_by_token_hash(token_hash)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
        )

    # Validate expiration
    try:
        expires_at = datetime.fromisoformat(session["expires_at"])
        if expires_at <= datetime.now(timezone.utc):
            await db.delete_session(token_hash)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated.",
            )
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
        )

    user = await db.get_user(session["user_id"])
    if user is None or not user.get("is_active", False):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
        )

    # Throttled refresh of last_seen_at (at most once every 24 hours)
    try:
        last_seen = datetime.fromisoformat(session.get("last_seen_at", session["created_at"]))
        if datetime.now(timezone.utc) - last_seen > timedelta(hours=24):
            await db.touch_session_last_seen(token_hash)
    except Exception:
        pass

    # Carry user scope in the ContextVar for the current request
    current_user_id.set(user["id"])
    return user


async def require_user(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Require an authenticated and active user."""
    return user


async def require_admin(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    """Require an authenticated user with admin role."""
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required.",
        )
    return user
