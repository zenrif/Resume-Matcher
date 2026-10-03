"""Comprehensive multi-user isolation tests verifying data tenancy across all resources."""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.context import NoUserContextError
from app.auth.deps import AUTH_EXEMPT_PATH_PREFIXES
from app.auth.sessions import COOKIE_NAME, generate_token, hash_token
from app.database import Database, db
from app.main import app
from app.preview import PreviewValidationError, job_fingerprint, resume_fingerprint

pytestmark = pytest.mark.no_auth


@pytest.fixture
def user_a() -> dict[str, Any]:
    return {
        "id": "user-a-111",
        "email": "usera@example.com",
        "display_name": "User Alpha",
        "role": "user",
        "is_active": True,
        "content_language": "en",
        "daily_ai_limit": 30,
    }


@pytest.fixture
def user_b() -> dict[str, Any]:
    return {
        "id": "user-b-222",
        "email": "userb@example.com",
        "display_name": "User Beta",
        "role": "user",
        "is_active": True,
        "content_language": "id",
        "daily_ai_limit": 30,
    }


async def create_user_client(user: dict[str, Any]) -> AsyncClient:
    """Create a real authenticated AsyncClient backed by a valid session in the database."""
    existing = await db.get_user(user["id"])
    if not existing:
        await db.create_user(
            user_id=user["id"],
            email=user["email"],
            display_name=user["display_name"],
            role=user.get("role", "user"),
            is_active=user.get("is_active", True),
            content_language=user.get("content_language", "en"),
            daily_ai_limit=user.get("daily_ai_limit", 30),
        )

    token = generate_token()
    token_hash = hash_token(token)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    await db.create_session(token_hash=token_hash, user_id=user["id"], expires_at=expires_at)

    transport = ASGITransport(app=app)
    return AsyncClient(
        transport=transport,
        base_url="http://testserver",
        cookies={COOKIE_NAME: token},
    )


def test_auth_exempt_paths_pinned():
    """Pin the exemption list for draft rendering as specified in T2.5."""
    assert AUTH_EXEMPT_PATH_PREFIXES == ("/api/v1/resumes/render-drafts/",)


async def test_unauthenticated_requests_get_401():
    """Endpoints protected by require_user return 401 when no session is present."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # GET /api/v1/resumes
        res = await client.get("/api/v1/resumes")
        assert res.status_code == 401

        # GET /api/v1/applications
        res = await client.get("/api/v1/applications")
        assert res.status_code == 401

        # GET /api/v1/status
        res = await client.get("/api/v1/status")
        assert res.status_code == 401

        # Public liveness check stays open
        res = await client.get("/api/v1/health")
        assert res.status_code == 200

        # Draft render route is exempt from 401
        res = await client.get("/api/v1/resumes/render-drafts/non-existent-token")
        # 404 because token does not exist, but NOT 401 unauthorized
        assert res.status_code == 404


async def test_direct_db_access_without_scope_fails_closed():
    """Production Database instance with no fallback raises NoUserContextError outside a user context."""
    strict_db = Database()
    with pytest.raises(NoUserContextError):
        await strict_db.get_stats()

    with pytest.raises(NoUserContextError):
        await strict_db.list_resumes()


async def test_background_task_context_propagation(user_a: dict[str, Any]):
    """asyncio.create_task inherits the ContextVar, allowing background tasks to maintain user scope."""
    async with db.acting_as(user_a["id"]):
        task_uid: str | None = None

        async def worker():
            nonlocal task_uid
            # ContextVar is preserved
            task_uid = db._uid()
            # Can run queries under user_a
            return await db.get_stats()

        stats = await asyncio.create_task(worker())
        assert task_uid == user_a["id"]
        assert isinstance(stats, dict)


async def test_resumes_isolation(user_a: dict[str, Any], user_b: dict[str, Any]):
    """User B cannot see, read, patch, or delete User A's resumes."""
    client_a = await create_user_client(user_a)
    client_b = await create_user_client(user_b)

    try:
        # User A creates a master resume
        async with db.acting_as(user_a["id"]):
            created = await db.create_resume_atomic_master(
                resume_id="resume-a-master",
                content="# Resume A Master",
                is_master=True,
                is_default_master=True,
                title="Alpha Master",
            )
            resume_id = created["resume_id"]

        # User A sees it
        res_a = await client_a.get("/api/v1/resumes", params={"resume_id": resume_id})
        assert res_a.status_code == 200
        assert res_a.json()["data"]["resume_id"] == resume_id

        # User B gets 404 for User A's resume
        res_b = await client_b.get("/api/v1/resumes", params={"resume_id": resume_id})
        assert res_b.status_code == 404

        # User B's list does not contain User A's resume
        list_b = await client_b.get("/api/v1/resumes/list", params={"include_master": True})
        assert list_b.status_code == 200
        assert not any(r["resume_id"] == resume_id for r in list_b.json()["data"])

        # User B cannot patch User A's resume
        patch_b = await client_b.patch(
            f"/api/v1/resumes/{resume_id}",
            json={"title": "Hacked Title"},
        )
        assert patch_b.status_code == 404

        # User B cannot delete User A's resume
        del_b = await client_b.delete(f"/api/v1/resumes/{resume_id}")
        assert del_b.status_code == 404

        # User A's resume is unchanged
        async with db.acting_as(user_a["id"]):
            unchanged = await db.get_resume(resume_id)
            assert unchanged is not None
            assert unchanged["title"] == "Alpha Master"

    finally:
        await client_a.aclose()
        await client_b.aclose()


async def test_applications_isolation(user_a: dict[str, Any], user_b: dict[str, Any]):
    """User B cannot access or modify User A's kanban applications."""
    client_a = await create_user_client(user_a)
    client_b = await create_user_client(user_b)

    try:
        # User A creates a master resume first (needed for application)
        async with db.acting_as(user_a["id"]):
            r_a = await db.create_resume_atomic_master(
                content="Developer resume",
                is_master=True,
                is_default_master=True,
            )
            resume_id = r_a["resume_id"]

        # User A creates an application
        res_create = await client_a.post(
            "/api/v1/applications",
            json={
                "resume_id": resume_id,
                "company": "Acme Corp",
                "role": "Lead Architect",
                "status": "applied",
                "job_description": "We are seeking a Lead Architect with distributed systems experience.",
            },
        )
        assert res_create.status_code == 200
        app_id = res_create.json()["application_id"]

        # User A sees it in their application tracker
        list_a = await client_a.get("/api/v1/applications")
        assert list_a.status_code == 200
        assert any(
            item["application_id"] == app_id
            for col in list_a.json()["columns"].values()
            if isinstance(col, list)
            for item in col
        )

        # User B gets 404 when reading detail
        res_detail_b = await client_b.get(f"/api/v1/applications/{app_id}")
        assert res_detail_b.status_code == 404

        # User B's list is completely empty of User A's applications
        list_b = await client_b.get("/api/v1/applications")
        assert list_b.status_code == 200
        for col in list_b.json()["columns"].values():
            if isinstance(col, list):
                assert not any(item["application_id"] == app_id for item in col)

        # User B cannot update User A's application
        update_b = await client_b.patch(
            f"/api/v1/applications/{app_id}",
            json={"status": "rejected"},
        )
        assert update_b.status_code == 404

        # User B cannot delete User A's application
        delete_b = await client_b.delete(f"/api/v1/applications/{app_id}")
        assert delete_b.status_code == 404

        # User A's application remains applied
        res_detail_a = await client_a.get(f"/api/v1/applications/{app_id}")
        assert res_detail_a.status_code == 200
        assert res_detail_a.json()["status"] == "applied"

    finally:
        await client_a.aclose()
        await client_b.aclose()


async def test_content_language_per_user(user_a: dict[str, Any], user_b: dict[str, Any]):
    """Content language is read and updated per user."""
    client_a = await create_user_client(user_a)
    client_b = await create_user_client(user_b)

    try:
        # User A gets English content language
        res_a = await client_a.get("/api/v1/config/language")
        assert res_a.status_code == 200
        assert res_a.json()["content_language"] == "en"

        # User B gets Indonesian content language
        res_b = await client_b.get("/api/v1/config/language")
        assert res_b.status_code == 200
        assert res_b.json()["content_language"] == "id"

        # User A updates content language to 'fr'
        put_a = await client_a.put("/api/v1/config/language", json={"content_language": "fr"})
        assert put_a.status_code == 200
        assert put_a.json()["content_language"] == "fr"

        # User B's content language remains 'id'
        res_b2 = await client_b.get("/api/v1/config/language")
        assert res_b2.status_code == 200
        assert res_b2.json()["content_language"] == "id"

    finally:
        await client_a.aclose()
        await client_b.aclose()


async def test_tailoring_previews_and_improvements_isolation(
    user_a: dict[str, Any], user_b: dict[str, Any]
):
    """User B cannot read or claim previews and improvements created by User A."""
    # Create user_a and user_b
    await create_user_client(user_a)
    await create_user_client(user_b)

    content_src = "# Developer Resume"
    job_text = "Senior Python Engineer"

    async with db.acting_as(user_a["id"]):
        # Create resume and job under user_a
        r = await db.create_resume_atomic_master(
            resume_id="res-a-src",
            content=content_src,
            is_master=True,
            is_default_master=True,
        )
        j = await db.create_job(content=job_text)
        job_id = j["job_id"]

        # Register preview under user_a
        source_hash = resume_fingerprint(content_src, None, None)
        j_hash = job_fingerprint(job_text)
        preview_res = await db.register_preview(
            source_id="res-a-src",
            job_id=job_id,
            payload_hash="payload-hash-xyz",
            source_hash=source_hash,
            job_hash=j_hash,
            prompt_id="prompt-1",
            ttl_seconds=3600,
        )
        preview_id = preview_res["preview_id"]

        # Create improvement under user_a
        imp = await db.create_improvement(
            original_resume_id="res-a-src",
            tailored_resume_id="res-a-tailored",
            job_id=job_id,
            improvements=[{"section": "summary", "text": "Enhanced summary"}],
        )

    # Verify user_a can claim preview and read improvement
    async with db.acting_as(user_a["id"]):
        claim_a = await db.claim_preview(
            preview_id=preview_id,
            source_id="res-a-src",
            job_id=job_id,
            payload_hash="payload-hash-xyz",
            lease_seconds=300,
        )
        assert claim_a.preview_id == preview_id

        imp_a = await db.get_improvement_by_tailored_resume("res-a-tailored")
        assert imp_a is not None
        assert imp_a["user_id"] == user_a["id"]

    # Verify user_b CANNOT claim preview or read improvement
    async with db.acting_as(user_b["id"]):
        with pytest.raises(PreviewValidationError):
            await db.claim_preview(
                preview_id=preview_id,
                source_id="res-a-src",
                job_id=job_id,
                payload_hash="payload-hash-xyz",
                lease_seconds=300,
            )

        imp_b = await db.get_improvement_by_tailored_resume("res-a-tailored")
        assert imp_b is None
