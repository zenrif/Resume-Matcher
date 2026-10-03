"""Integration test for legacy database migration and multi-user isolation invariants."""

import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import text

from app.database import Database, MasterResumeLimitError
from app.db_engine import init_models_sync


@pytest.mark.no_auth
async def test_legacy_db_migration_and_per_user_indexes(tmp_path: Path) -> None:
    """A legacy DB without user_id is migrated, orphan rows backfilled, and default master per-user."""
    db_file = tmp_path / "legacy_test.db"

    # Step 1: Create a legacy database schema before multi-user isolation
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE resumes (
        resume_id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        content_type TEXT DEFAULT 'md',
        filename TEXT,
        is_master BOOLEAN DEFAULT 0,
        is_default_master BOOLEAN DEFAULT 0,
        parent_id TEXT,
        processed_data TEXT,
        processing_status TEXT DEFAULT 'pending',
        processing_token TEXT,
        cover_letter TEXT,
        outreach_message TEXT,
        interview_prep TEXT,
        title TEXT,
        original_markdown TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """)

    cursor.execute("""
    CREATE UNIQUE INDEX ux_resumes_single_default_master
      ON resumes (is_default_master) WHERE is_default_master = 1;
    """)

    cursor.execute("""
    CREATE TABLE jobs (
        job_id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        resume_id TEXT,
        created_at TEXT NOT NULL,
        metadata_json TEXT DEFAULT '{}'
    );
    """)

    cursor.execute("""
    CREATE TABLE improvements (
        request_id TEXT PRIMARY KEY,
        original_resume_id TEXT NOT NULL,
        tailored_resume_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        improvements TEXT DEFAULT '[]',
        created_at TEXT NOT NULL
    );
    """)

    cursor.execute("""
    CREATE TABLE tailoring_previews (
        preview_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        source_hash TEXT,
        job_hash TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        result_resume_id TEXT,
        claim_token TEXT,
        claim_expires_at TEXT,
        response_data TEXT,
        improvements TEXT,
        source_data TEXT
    );
    """)

    cursor.execute("""
    CREATE TABLE applications (
        application_id TEXT PRIMARY KEY,
        job_id TEXT,
        resume_id TEXT,
        master_resume_id TEXT,
        status TEXT NOT NULL,
        company TEXT,
        role TEXT,
        applied_at TEXT,
        notes TEXT,
        position INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """)

    # Insert sample legacy rows
    cursor.execute(
        "INSERT INTO resumes (resume_id, content, is_master, is_default_master, created_at, updated_at) "
        "VALUES ('legacy-r1', 'content 1', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
    )
    cursor.execute(
        "INSERT INTO jobs (job_id, content, created_at) "
        "VALUES ('legacy-j1', 'Python dev', '2026-01-01T00:00:00Z')"
    )
    cursor.execute(
        "INSERT INTO applications (application_id, status, created_at, updated_at) "
        "VALUES ('legacy-app1', 'applied', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
    )

    conn.commit()
    conn.close()

    # Step 2: Initialize Database instance which runs init_models_sync
    db = Database(db_path=db_file)
    db._ensure_initialized()
    try:
        # Verify columns were added
        conn = sqlite3.connect(db_file)
        cursor = conn.cursor()
        for tbl in ["resumes", "jobs", "improvements", "tailoring_previews", "applications"]:
            cursor.execute(f"PRAGMA table_info({tbl})")
            cols = [row[1] for row in cursor.fetchall()]
            assert "user_id" in cols, f"user_id column missing in {tbl}"

        # Verify old unique index is gone and new index exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='index'")
        indexes = [row[0] for row in cursor.fetchall()]
        assert "ux_resumes_single_default_master" not in indexes
        assert "ux_resumes_default_master_per_user" in indexes

        conn.close()

        # Step 3: Backfill orphan rows to admin
        admin_id = "admin-user-id"
        backfilled_count = await db.assign_orphan_rows(admin_id)
        assert sum(backfilled_count.values()) >= 3

        # Verify rows now belong to admin
        async with db.acting_as(admin_id):
            r = await db.get_resume("legacy-r1")
            assert r is not None
            assert r["user_id"] == admin_id

            j = await db.get_job("legacy-j1")
            assert j is not None
            assert j["user_id"] == admin_id

            app = await db.get_application("legacy-app1")
            assert app is not None
            assert app["user_id"] == admin_id

        # Step 4: Verify two users can each hold a default master resume
        user_a = "user-a"
        user_b = "user-b"

        async with db.acting_as(user_a):
            res_a = await db.create_resume_atomic_master(
                resume_id="resume-a-default",
                content="User A Master",
                is_master=True,
                is_default_master=True,
            )
            assert res_a["is_default_master"] is True

        async with db.acting_as(user_b):
            res_b = await db.create_resume_atomic_master(
                resume_id="resume-b-default",
                content="User B Master",
                is_master=True,
                is_default_master=True,
            )
            assert res_b["is_default_master"] is True

        # Step 5: Verify 5-master limit is enforced per-user
        async with db.acting_as(user_a):
            # user_a already has 1 master. Add 4 more masters:
            for i in range(2, 6):
                await db.create_resume_atomic_master(
                    resume_id=f"resume-a-master-{i}",
                    content=f"User A Master {i}",
                    is_master=True,
                    is_default_master=False,
                )

            # 6th master for user_a must fail with MasterResumeLimitError
            with pytest.raises(MasterResumeLimitError):
                await db.create_resume_atomic_master(
                    resume_id="resume-a-master-6",
                    content="User A Master 6",
                    is_master=True,
                    is_default_master=False,
                )

        # user_b still only has 1 master and can create more
        async with db.acting_as(user_b):
            await db.create_resume_atomic_master(
                resume_id="resume-b-master-2",
                content="User B Master 2",
                is_master=True,
                is_default_master=False,
            )
            stats_b = await db.get_stats()
            assert stats_b["total_resumes"] == 2
            assert stats_b["has_master_resume"] is True

    finally:
        await db.close()
