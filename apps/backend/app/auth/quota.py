from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from fastapi import Depends, Request

from app.auth.deps import require_user
from app.database import db

try:
    from zoneinfo import ZoneInfo
    JAKARTA_TZ = ZoneInfo("Asia/Jakarta")
except Exception:
    JAKARTA_TZ = timezone(timedelta(hours=7))

# Optional clock override for deterministic tests
_custom_clock: Callable[[], datetime] | None = None


def set_custom_clock(clock: Callable[[], datetime] | None) -> None:
    """Set a custom datetime provider for tests."""
    global _custom_clock
    _custom_clock = clock


def current_jakarta_day() -> str:
    """Return the current date string (YYYY-MM-DD) in Asia/Jakarta timezone."""
    now = _custom_clock() if _custom_clock is not None else datetime.now(JAKARTA_TZ)
    if now.tzinfo is None:
        now = now.replace(tzinfo=JAKARTA_TZ)
    else:
        now = now.astimezone(JAKARTA_TZ)
    return now.strftime("%Y-%m-%d")


class QuotaExceededError(Exception):
    """Raised when a user has exceeded their daily AI operation quota."""

    def __init__(self, message: str = "Daily AI limit reached. Please try again tomorrow.") -> None:
        super().__init__(message)
        self.message = message


async def consume_ai_quota(
    request: Request,
    user: dict[str, Any] = Depends(require_user),
) -> None:
    """Atomically consume one AI operation from the user's daily quota.

    Raises QuotaExceededError (HTTP 429) if the limit is exceeded.
    users.daily_ai_limit IS NULL means unlimited.
    """
    limit = user.get("daily_ai_limit")
    day = current_jakarta_day()

    if limit is None:
        # Unlimited operations: record usage without cap
        await db.increment_ai_usage_unlimited(user_id=user["id"], day=day)
        return

    # Enforce atomic upsert limit
    success = await db.increment_ai_usage_bounded(
        user_id=user["id"],
        day=day,
        limit=int(limit),
    )
    if not success:
        raise QuotaExceededError("Daily AI limit reached. Please try again tomorrow.")
