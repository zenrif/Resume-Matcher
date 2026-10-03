"""Context variables and errors for user scoping."""

from __future__ import annotations

from contextvars import ContextVar


current_user_id: ContextVar[str | None] = ContextVar("current_user_id", default=None)
current_content_language: ContextVar[str | None] = ContextVar("current_content_language", default=None)


class NoUserContextError(RuntimeError):
    """Raised when an operation requires an active user context but none was found."""


def require_user_id() -> str:
    """Return the current user ID or raise NoUserContextError if outside user context."""
    user_id = current_user_id.get()
    if not user_id:
        raise NoUserContextError("No active user context found.")
    return user_id
