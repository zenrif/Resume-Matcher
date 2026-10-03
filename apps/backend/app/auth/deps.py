"""FastAPI dependencies for authentication, role gating, and client IP resolution."""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import Depends, HTTPException, Request, status

from app.auth.context import current_content_language, current_user_id
from app.auth.sessions import COOKIE_NAME, hash_token
from app.config import settings


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
    from app.database import db

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
    if user.get("content_language"):
        current_content_language.set(user["content_language"])
    return user


AUTH_EXEMPT_PATH_PREFIXES: tuple[str, ...] = (
    "/api/v1/resumes/render-drafts/",
)


async def require_user(request: Request) -> dict[str, Any] | None:
    """Require an authenticated and active user, except for exempt routes."""
    path = request.url.path
    for prefix in AUTH_EXEMPT_PATH_PREFIXES:
        if path.startswith(prefix) or path.startswith(prefix.removeprefix("/api/v1")):
            return None

    override = request.app.dependency_overrides.get(get_current_user)
    if override:
        import inspect
        res = override(request) if len(inspect.signature(override).parameters) > 0 else override()
        user = await res if inspect.isawaitable(res) else res
        if isinstance(user, dict):
            if "id" in user:
                current_user_id.set(user["id"])
            if user.get("content_language"):
                current_content_language.set(user["content_language"])
        return user

    return await get_current_user(request)


async def require_admin(request: Request) -> dict[str, Any]:
    """Require an authenticated user with admin role."""
    override = request.app.dependency_overrides.get(get_current_user)
    if override:
        import inspect
        res = override(request) if len(inspect.signature(override).parameters) > 0 else override()
        user = await res if inspect.isawaitable(res) else res
        if isinstance(user, dict):
            if "id" in user:
                current_user_id.set(user["id"])
            if user.get("content_language"):
                current_content_language.set(user["content_language"])
    else:
        user = await get_current_user(request)

    if not isinstance(user, dict) or user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required.",
        )
    return user
