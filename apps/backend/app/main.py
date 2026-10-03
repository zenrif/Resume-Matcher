"""FastAPI application entry point."""

import asyncio
import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response, status
from fastapi.responses import JSONResponse

# Fix for Windows: Use ProactorEventLoop for subprocess support (Playwright)
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

logger = logging.getLogger(__name__)
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.ai_budget import operation_error_content
from app.config import settings
from app.database import DatabaseBusyError, db
from app.pdf import close_pdf_renderer, init_pdf_renderer
from app.routers import (
    admin_users_router,
    applications_router,
    auth_router,
    config_router,
    enrichment_router,
    health_router,
    jobs_router,
    resume_wizard_router,
    resumes_router,
)
from app.routers.resumes import drain_processing_cleanup_tasks


def _configure_application_logging() -> None:
    """Set application log level from configuration."""
    numeric_level = getattr(logging, settings.log_level, logging.INFO)
    logging.getLogger("app").setLevel(numeric_level)


_configure_application_logging()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan manager."""
    # Startup
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    # Import a legacy TinyDB database into SQLite if present (idempotent).
    # Fail-fast on error: starting with an empty DB would look like data loss.
    from app.scripts.migrate_tinydb_to_sqlite import migrate as migrate_tinydb

    result = await migrate_tinydb()
    if result.get("status") == "migrated":
        logger.info("Startup data migration: %s", result)
    # Fold any legacy plaintext API keys into the encrypted store (idempotent,
    # non-clobbering), then strip them from config.json.
    from app.config import migrate_legacy_keys

    migrate_legacy_keys()

    # Bootstrap initial admin account if users table is empty
    user_count = await db.count_users()
    if user_count == 0:
        if settings.admin_email:
            from datetime import timedelta, timezone
            from uuid import uuid4
            from app.auth.sessions import generate_token, hash_token

            admin_id = str(uuid4())
            admin_email = settings.admin_email.strip().lower()
            admin_name = admin_email.split("@")[0].capitalize()
            await db.create_user(
                id=admin_id,
                email=admin_email,
                display_name=admin_name,
                password_hash=None,
                role="admin",
                is_active=True,
                content_language="id",
                daily_ai_limit=None,
            )
            token = generate_token()
            token_hash = hash_token(token)
            expires_at = (
                datetime.now(timezone.utc) + timedelta(days=settings.invite_ttl_days)
            ).isoformat()
            await db.create_invite(
                token_hash=token_hash,
                user_id=admin_id,
                purpose="invite",
                expires_at=expires_at,
            )
            await db.assign_orphan_rows(admin_id)
            logger.info(
                "Bootstrap admin invite: %s/invite/%s",
                settings.effective_public_base_url,
                token,
            )
        else:
            logger.warning(
                "No users exist and ADMIN_EMAIL is unset. Run 'python -m app.scripts.create_admin --email <email>' to create an admin."
            )

    # PDF renderer uses lazy initialization - will initialize on first use
    # await init_pdf_renderer()
    yield
    # Shutdown - wrap each cleanup in try-except to ensure all resources are released
    try:
        await drain_processing_cleanup_tasks()
    except Exception:
        logger.exception("Error draining processing cleanup")

    try:
        await close_pdf_renderer()
    except Exception as e:
        logger.error(f"Error closing PDF renderer: {e}")

    try:
        await db.close()
    except Exception as e:
        logger.error(f"Error closing database: {e}")


app = FastAPI(
    title="Resume Matcher API",
    description="AI-powered resume tailoring for job descriptions",
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)


@app.middleware("http")
async def verify_origin_middleware(request: Request, call_next: Any) -> Response:
    """Block state-changing requests from origins outside the allowed CORS list."""
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        origin = request.headers.get("origin")
        if origin:
            normalized_origin = origin.strip().rstrip("/")
            normalized_allowed = {o.strip().rstrip("/") for o in settings.effective_cors_origins}
            if normalized_origin not in normalized_allowed:
                return JSONResponse(
                    status_code=status.HTTP_403_FORBIDDEN,
                    content={"detail": "Origin not allowed."},
                )
    return await call_next(request)


from app.auth.quota import QuotaExceededError


@app.exception_handler(DatabaseBusyError)
async def database_busy_handler(request: Request, error: DatabaseBusyError) -> JSONResponse:
    logger.warning("Database write contention for %s", request.url.path, exc_info=error)
    return JSONResponse(
        status_code=503,
        content=operation_error_content(request, "Database is busy. Please retry shortly."),
        headers={"Retry-After": "1"},
    )


@app.exception_handler(QuotaExceededError)
async def quota_exceeded_handler(request: Request, error: QuotaExceededError) -> JSONResponse:
    content = operation_error_content(request, str(error.message))
    content["code"] = "ai_quota_exceeded"
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content=content,
    )


# CORS middleware - origins configurable via CORS_ORIGINS env var
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.effective_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router, prefix="/api/v1")
app.include_router(admin_users_router, prefix="/api/v1")
app.include_router(health_router, prefix="/api/v1")
app.include_router(config_router, prefix="/api/v1")
app.include_router(resumes_router, prefix="/api/v1")
app.include_router(jobs_router, prefix="/api/v1")
app.include_router(enrichment_router, prefix="/api/v1")
app.include_router(applications_router, prefix="/api/v1")
app.include_router(resume_wizard_router, prefix="/api/v1")


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "Resume Matcher API",
        "version": __version__,
        "docs": "/docs",
    }


def main():
    """Entry point for the project.scripts console script."""
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload,
    )


if __name__ == "__main__":
    main()
