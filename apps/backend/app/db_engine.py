"""SQLite engine/session plumbing for the SQLAlchemy data layer.

Every ``Database`` instance owns its own engines (one async for the document
tables, one sync for the encrypted ``api_keys`` table read on the synchronous
LLM hot path) built from these factories. Keeping construction here lets tests
spin up fully isolated engines against a temp-file database.
"""

from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.models import Base

__all__ = ["Base", "make_async_engine", "make_sync_engine", "init_models_sync"]


def _apply_sqlite_pragmas(dbapi_connection: Any, _connection_record: Any) -> None:
    """Set per-connection SQLite PRAGMAs.

    WAL improves concurrent read/write between the async (doc tables) and sync
    (api_keys) engines pointed at the same file; ``busy_timeout`` rides out the
    brief lock contention that creates; ``foreign_keys`` enforces relational
    integrity (off by default in SQLite).
    """
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
    finally:
        cursor.close()


def _url(path: Path, *, driver: str) -> str:
    """Build a SQLite URL. Absolute paths yield the required four slashes."""
    return f"sqlite+{driver}:///{path}" if driver else f"sqlite:///{path}"


def make_async_engine(path: Path) -> AsyncEngine:
    """Create the async engine (``aiosqlite``) for the document tables."""
    engine = create_async_engine(_url(path, driver="aiosqlite"), future=True)
    event.listen(engine.sync_engine, "connect", _apply_sqlite_pragmas)
    return engine


def make_sync_engine(path: Path) -> Engine:
    """Create the sync engine used for the encrypted api_keys table.

    Key reads happen synchronously (``get_llm_config`` → ``load_config_file`` →
    ``resolve_api_key``), so a sync engine avoids threading async through
    ``llm.py``. It points at the same file as the async engine.
    """
    engine = create_engine(_url(path, driver=""), future=True)
    event.listen(engine, "connect", _apply_sqlite_pragmas)
    return engine


def init_models_sync(engine: Engine) -> None:
    """Create all tables (idempotent) using a sync engine connection."""
    Base.metadata.create_all(engine)

    # ``create_all`` does not ALTER existing SQLite tables. Keep this additive
    # migration idempotent so older local databases can load resumes safely.
    with engine.begin() as conn:
        columns = conn.exec_driver_sql("PRAGMA table_info(resumes)").mappings().all()
        existing_columns = {column["name"] for column in columns}
        if columns and "interview_prep" not in existing_columns:
            conn.exec_driver_sql("ALTER TABLE resumes ADD COLUMN interview_prep TEXT")
        if columns and "processing_token" not in existing_columns:
            conn.exec_driver_sql("ALTER TABLE resumes ADD COLUMN processing_token TEXT")

        if columns and "is_master" in existing_columns:
            if "is_default_master" not in existing_columns:
                conn.exec_driver_sql(
                    "ALTER TABLE resumes ADD COLUMN is_default_master BOOLEAN NOT NULL DEFAULT 0"
                )
            # Multi-track masters: the single-master slot is replaced by a
            # per-user default slot. create_all never drops indexes on existing tables.
            conn.exec_driver_sql("DROP INDEX IF EXISTS ux_resumes_single_master")
            conn.exec_driver_sql("DROP INDEX IF EXISTS ux_resumes_single_default_master")

        # Migrate user_id on document tables (T2.2)
        doc_tables = ("resumes", "jobs", "improvements", "tailoring_previews", "applications")
        for table in doc_tables:
            t_cols = conn.exec_driver_sql(f"PRAGMA table_info({table})").mappings().all()
            if t_cols:
                t_col_names = {c["name"] for c in t_cols}
                if "user_id" not in t_col_names:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN user_id TEXT")
                conn.exec_driver_sql(f"CREATE INDEX IF NOT EXISTS ix_{table}_user_id ON {table} (user_id)")

        # Per-user default master index and promotion (T2.2)
        if columns and "is_master" in existing_columns:
            if "created_at" in existing_columns:
                conn.exec_driver_sql(
                    "UPDATE resumes "
                    "SET is_default_master = 1 "
                    "WHERE resume_id IN ("
                    "  SELECT r1.resume_id FROM resumes r1 "
                    "  WHERE r1.is_master = 1 "
                    "    AND NOT EXISTS ("
                    "      SELECT 1 FROM resumes r2 "
                    "      WHERE r2.is_default_master = 1 "
                    "        AND (r2.user_id = r1.user_id OR (r2.user_id IS NULL AND r1.user_id IS NULL))"
                    "    ) "
                    "    AND r1.resume_id = ("
                    "      SELECT r3.resume_id FROM resumes r3 "
                    "      WHERE r3.is_master = 1 "
                    "        AND (r3.user_id = r1.user_id OR (r3.user_id IS NULL AND r1.user_id IS NULL)) "
                    "      ORDER BY r3.created_at, r3.resume_id "
                    "      LIMIT 1"
                    "    )"
                    ")"
                )
            conn.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_resumes_default_master_per_user "
                "ON resumes (user_id, is_default_master) WHERE is_default_master = 1"
            )

        preview_columns = conn.exec_driver_sql("PRAGMA table_info(tailoring_previews)").mappings().all()
        if preview_columns and "improvements" not in {column["name"] for column in preview_columns}:
            conn.exec_driver_sql("ALTER TABLE tailoring_previews ADD COLUMN improvements JSON")
        if preview_columns and "source_data" not in {column["name"] for column in preview_columns}:
            conn.exec_driver_sql("ALTER TABLE tailoring_previews ADD COLUMN source_data JSON")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_preview_compatibility ON tailoring_previews (source_id, job_id, payload_hash, created_at)")
