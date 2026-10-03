"""Integration tests for print tokens and X-Print-Token fallback authentication."""

from typing import Any
import pytest
from httpx import ASGITransport, AsyncClient

from app.database import db
from app.main import app
from app.services.print_tokens import PrintGrant, PrintTokenStore, print_tokens

pytestmark = pytest.mark.no_auth


def test_print_token_store_unit_with_fake_clock():
    """Unit test for PrintTokenStore TTL and eviction using an injected clock."""
    current_time = 1000.0

    def fake_clock() -> float:
        return current_time

    store = PrintTokenStore(ttl_seconds=10.0, max_entries=2, clock=fake_clock)

    # Put first entry
    t1 = store.put(user_id="u1", resume_id="r1")
    assert store.get(t1) == PrintGrant(user_id="u1", resume_id="r1")

    # Advance time slightly within TTL
    current_time += 5.0
    assert store.get(t1) == PrintGrant(user_id="u1", resume_id="r1")

    # Put second entry
    t2 = store.put(user_id="u2", resume_id="r2")
    assert store.get(t2) == PrintGrant(user_id="u2", resume_id="r2")

    # Put third entry (exceeds max_entries=2; t1 should be evicted)
    t3 = store.put(user_id="u3", resume_id="r3")
    assert store.get(t1) is None
    assert store.get(t2) == PrintGrant(user_id="u2", resume_id="r2")
    assert store.get(t3) == PrintGrant(user_id="u3", resume_id="r3")

    # Advance time past TTL of t2 and t3
    current_time += 11.0
    assert store.get(t2) is None
    assert store.get(t3) is None

    # Test explicit discard
    current_time = 2000.0
    t4 = store.put(user_id="u4", resume_id="r4")
    assert store.get(t4) is not None
    store.discard(t4)
    assert store.get(t4) is None


@pytest.fixture
async def print_test_setup():
    """Set up test users and resumes in the database."""
    # Active user A
    await db.create_user(
        user_id="print-user-a",
        email="print-a@example.com",
        display_name="Print User A",
        role="user",
        is_active=True,
    )
    # Deactivated user B
    await db.create_user(
        user_id="print-user-b-inactive",
        email="print-b@example.com",
        display_name="Print User B Inactive",
        role="user",
        is_active=False,
    )

    async with db.acting_as("print-user-a"):
        await db.create_resume_atomic_master(
            resume_id="res-print-a1",
            content="# Print Resume A1",
            is_master=True,
            is_default_master=True,
        )
        await db.create_resume_atomic_master(
            resume_id="res-print-a2",
            content="# Print Resume A2",
            is_master=True,
            is_default_master=False,
        )

    async with db.acting_as("print-user-b-inactive"):
        await db.create_resume_atomic_master(
            resume_id="res-print-b1",
            content="# Print Resume B1",
            is_master=True,
            is_default_master=True,
        )


async def test_valid_print_token_allows_fetching_assigned_resume(print_test_setup):
    """A valid X-Print-Token allows GET /api/v1/resumes for the granted resume only."""
    token = print_tokens.put(user_id="print-user-a", resume_id="res-print-a1")
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://testserver"
        ) as client:
            res = await client.get(
                "/api/v1/resumes",
                params={"resume_id": "res-print-a1"},
                headers={"X-Print-Token": token},
            )
            assert res.status_code == 200
            assert res.json()["data"]["resume_id"] == "res-print-a1"
    finally:
        print_tokens.discard(token)


async def test_print_token_cannot_fetch_different_resume(print_test_setup):
    """A print token for resume A cannot be used to fetch resume B."""
    token = print_tokens.put(user_id="print-user-a", resume_id="res-print-a1")
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://testserver"
        ) as client:
            res = await client.get(
                "/api/v1/resumes",
                params={"resume_id": "res-print-a2"},
                headers={"X-Print-Token": token},
            )
            assert res.status_code == 401
    finally:
        print_tokens.discard(token)


async def test_expired_or_invalid_print_token_returns_401(print_test_setup):
    """An unknown or expired print token returns 401."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        res = await client.get(
            "/api/v1/resumes",
            params={"resume_id": "res-print-a1"},
            headers={"X-Print-Token": "non-existent-or-expired-token"},
        )
        assert res.status_code == 401


async def test_print_token_rejected_for_non_get(print_test_setup):
    """X-Print-Token is rejected for non-GET methods."""
    token = print_tokens.put(user_id="print-user-a", resume_id="res-print-a1")
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://testserver"
        ) as client:
            res = await client.delete(
                "/api/v1/resumes/res-print-a1",
                headers={"X-Print-Token": token},
            )
            assert res.status_code == 401
    finally:
        print_tokens.discard(token)


async def test_print_token_rejected_for_other_endpoints(print_test_setup):
    """X-Print-Token is rejected for endpoints other than GET /api/v1/resumes."""
    token = print_tokens.put(user_id="print-user-a", resume_id="res-print-a1")
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://testserver"
        ) as client:
            res_jobs = await client.get(
                "/api/v1/jobs/any-job-id",
                headers={"X-Print-Token": token},
            )
            assert res_jobs.status_code == 401

            res_apps = await client.get(
                "/api/v1/applications",
                headers={"X-Print-Token": token},
            )
            assert res_apps.status_code == 401

            res_status = await client.get(
                "/api/v1/status",
                headers={"X-Print-Token": token},
            )
            assert res_status.status_code == 401
    finally:
        print_tokens.discard(token)


async def test_print_token_for_deactivated_user_returns_401(print_test_setup):
    """A print token for a deactivated user returns 401."""
    token = print_tokens.put(user_id="print-user-b-inactive", resume_id="res-print-b1")
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://testserver"
        ) as client:
            res = await client.get(
                "/api/v1/resumes",
                params={"resume_id": "res-print-b1"},
                headers={"X-Print-Token": token},
            )
            assert res.status_code == 401
    finally:
        print_tokens.discard(token)
