"""Integration tests for daily AI operation quota enforcement, atomicity, and rollover."""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.quota import JAKARTA_TZ, set_custom_clock
from app.auth.sessions import COOKIE_NAME, generate_token, hash_token
from app.database import db
from app.main import app

pytestmark = pytest.mark.no_auth


async def create_client_with_limit(
    *, user_id: str, email: str, limit: int | None
) -> AsyncClient:
    """Create an authenticated AsyncClient with a specific daily AI limit."""
    user = await db.get_user(user_id)
    if not user:
        await db.create_user(
            user_id=user_id,
            email=email,
            display_name=f"User {user_id}",
            role="user",
            is_active=True,
            daily_ai_limit=limit,
        )
    else:
        await db.update_user(user_id, daily_ai_limit=limit)

    token = generate_token()
    token_hash = hash_token(token)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    await db.create_session(token_hash=token_hash, user_id=user_id, expires_at=expires_at)

    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
        cookies={COOKIE_NAME: token},
    )


async def test_quota_limit_reached_returns_429():
    """When a user reaches their daily limit, AI endpoints return 429 with ai_quota_exceeded code."""
    client = await create_client_with_limit(user_id="quota-user-1", email="q1@example.com", limit=2)
    try:
        # Create a resume with processed_data
        async with db.acting_as("quota-user-1"):
            r = await db.create_resume_atomic_master(
                resume_id="res-q1",
                content="# Q1 Resume",
                is_master=True,
                is_default_master=True,
            )
            await db.update_resume("res-q1", {"processed_data": {"experience": [{"title": "Dev"}]}})

        # Mock out LLM call
        with patch(
            "app.routers.enrichment.complete_json",
            return_value={"items_to_enrich": [], "questions": []},
        ):
            # Operation 1: allowed
            res1 = await client.post("/api/v1/enrichment/analyze/res-q1")
            assert res1.status_code == 200

            # Operation 2: allowed
            res2 = await client.post("/api/v1/enrichment/analyze/res-q1")
            assert res2.status_code == 200

            # Operation 3: exceeded! -> 429
            res3 = await client.post("/api/v1/enrichment/analyze/res-q1")
            assert res3.status_code == 429
            body = res3.json()
            assert body.get("code") == "ai_quota_exceeded"
            assert "limit" in body.get("detail", "").lower()
    finally:
        await client.aclose()


async def test_quota_rollover_with_clock_manipulation():
    """When the date rolls over in Asia/Jakarta, quota resets and operations succeed again."""
    client = await create_client_with_limit(user_id="quota-user-rollover", email="qroll@example.com", limit=1)
    try:
        # Start at Day 1: 2026-10-03 10:00:00 Jakarta
        day1 = datetime(2026, 10, 3, 10, 0, 0, tzinfo=JAKARTA_TZ)
        set_custom_clock(lambda: day1)

        async with db.acting_as("quota-user-rollover"):
            await db.create_resume_atomic_master(
                resume_id="res-qroll",
                content="# Rollover Resume",
                is_master=True,
                is_default_master=True,
            )
            await db.update_resume("res-qroll", {"processed_data": {"experience": [{"title": "Dev"}]}})

        with patch(
            "app.routers.enrichment.complete_json",
            return_value={"items_to_enrich": [], "questions": []},
        ):
            # Use Day 1 quota
            res1 = await client.post("/api/v1/enrichment/analyze/res-qroll")
            assert res1.status_code == 200

            # Second call on Day 1 is blocked
            res2 = await client.post("/api/v1/enrichment/analyze/res-qroll")
            assert res2.status_code == 429

            # Advance clock to Day 2: 2026-10-04 01:00:00 Jakarta
            day2 = datetime(2026, 10, 4, 1, 0, 0, tzinfo=JAKARTA_TZ)
            set_custom_clock(lambda: day2)

            # Now on Day 2, operation succeeds again!
            res3 = await client.post("/api/v1/enrichment/analyze/res-qroll")
            assert res3.status_code == 200
    finally:
        set_custom_clock(None)
        await client.aclose()


async def test_unlimited_user_never_rate_limited():
    """A user with daily_ai_limit=None (unlimited) is never blocked."""
    client = await create_client_with_limit(user_id="quota-user-unlimited", email="qunlimited@example.com", limit=None)
    try:
        async with db.acting_as("quota-user-unlimited"):
            await db.create_resume_atomic_master(
                resume_id="res-qunlimited",
                content="# Unlimited Resume",
                is_master=True,
                is_default_master=True,
            )
            await db.update_resume("res-qunlimited", {"processed_data": {"experience": [{"title": "Dev"}]}})

        with patch(
            "app.routers.enrichment.complete_json",
            return_value={"items_to_enrich": [], "questions": []},
        ):
            for _ in range(5):
                res = await client.post("/api/v1/enrichment/analyze/res-qunlimited")
                assert res.status_code == 200

        # Verify GET /auth/me reflects the 5 operations
        me_res = await client.get("/api/v1/auth/me")
        assert me_res.status_code == 200
        assert me_res.json()["ai_used_today"] >= 5
    finally:
        await client.aclose()


async def test_concurrent_quota_consumption_atomic_ceiling():
    """Concurrent requests cannot overshoot the daily limit due to atomic upsert."""
    user_id = "quota-race-user"
    limit = 5
    await create_client_with_limit(user_id=user_id, email="race@example.com", limit=limit)

    day = "2026-10-03"

    # Concurrently attempt 20 increments
    async def try_increment():
        return await db.increment_ai_usage_bounded(user_id=user_id, day=day, limit=limit)

    results = await asyncio.gather(*(try_increment() for _ in range(20)))

    # Exactly `limit` attempts must return True, the other 15 must return False
    successful = [r for r in results if r is True]
    rejected = [r for r in results if r is False]

    assert len(successful) == limit
    assert len(rejected) == 20 - limit

    # Database count must be exactly limit
    recorded_count = await db.get_ai_usage_today(user_id=user_id, day=day)
    assert recorded_count == limit
