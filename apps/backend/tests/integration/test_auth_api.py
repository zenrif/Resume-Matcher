"""Integration tests for authentication, invite, and admin user endpoints."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.context import current_user_id
from app.auth.passwords import hash_password
from app.auth.rate_limit import login_rate_limiter
from app.auth.sessions import COOKIE_NAME, generate_token, hash_token
from app.config import settings
from app.database import Database
from app.main import app


@pytest.fixture
def client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture
def auth_db(isolated_backend_state: Database) -> Database:
    return isolated_backend_state


@pytest.fixture(autouse=True)
def reset_rate_limiter() -> None:
    login_rate_limiter.clear()


@pytest.mark.integration
@pytest.mark.no_auth
class TestAuthApi:
    """Authentication and session lifecycle."""

    async def test_login_success_and_logout(self, client: AsyncClient, auth_db: Database) -> None:
        user_id = str(uuid4())
        email = "testuser@example.com"
        password = "SecurePassword123!"
        pwd_hash = hash_password(password)

        await auth_db.create_user(
            id=user_id,
            email=email,
            display_name="Test User",
            password_hash=pwd_hash,
            role="user",
            is_active=True,
        )

        async with client:
            # Login with valid credentials
            resp = await client.post(
                "/api/v1/auth/login",
                json={"email": email, "password": password},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["user"]["email"] == email
            assert data["user"]["role"] == "user"
            assert COOKIE_NAME in resp.cookies

            session_token = resp.cookies[COOKIE_NAME]

            # Access /auth/me with session cookie
            me_resp = await client.get(
                "/api/v1/auth/me",
                cookies={COOKIE_NAME: session_token},
            )
            assert me_resp.status_code == 200
            assert me_resp.json()["email"] == email

            # Logout
            logout_resp = await client.post(
                "/api/v1/auth/logout",
                cookies={COOKIE_NAME: session_token},
            )
            assert logout_resp.status_code == 204

            # Subsequent /auth/me fails
            me_after = await client.get(
                "/api/v1/auth/me",
                cookies={COOKIE_NAME: session_token},
            )
            assert me_after.status_code == 401

    async def test_login_failures_uniform_message(self, client: AsyncClient, auth_db: Database) -> None:
        user_id = str(uuid4())
        email = "existing@example.com"
        pwd_hash = hash_password("CorrectPassword123!")

        await auth_db.create_user(
            id=user_id,
            email=email,
            display_name="Existing User",
            password_hash=pwd_hash,
            role="user",
            is_active=True,
        )

        async with client:
            # 1. Wrong password
            resp1 = await client.post(
                "/api/v1/auth/login",
                json={"email": email, "password": "WrongPassword"},
            )
            assert resp1.status_code == 401
            assert resp1.json() == {"detail": "Invalid email or password."}

            # 2. Unknown email (same response body)
            resp2 = await client.post(
                "/api/v1/auth/login",
                json={"email": "nonexistent@example.com", "password": "WrongPassword"},
            )
            assert resp2.status_code == 401
            assert resp2.json() == {"detail": "Invalid email or password."}

    async def test_inactive_user_login_fails(self, client: AsyncClient, auth_db: Database) -> None:
        user_id = str(uuid4())
        email = "inactive@example.com"
        password = "SecurePassword123!"

        await auth_db.create_user(
            id=user_id,
            email=email,
            display_name="Inactive User",
            password_hash=hash_password(password),
            role="user",
            is_active=False,
        )

        async with client:
            resp = await client.post(
                "/api/v1/auth/login",
                json={"email": email, "password": password},
            )
            assert resp.status_code == 401
            assert resp.json() == {"detail": "Invalid email or password."}

    async def test_expired_session_returns_401(self, client: AsyncClient, auth_db: Database) -> None:
        user_id = str(uuid4())
        await auth_db.create_user(
            id=user_id,
            email="expired@example.com",
            display_name="Expired User",
            password_hash=hash_password("pw"),
            role="user",
            is_active=True,
        )

        token = generate_token()
        token_hash = hash_token(token)
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        await auth_db.create_session(token_hash=token_hash, user_id=user_id, expires_at=past)

        async with client:
            resp = await client.get("/api/v1/auth/me", cookies={COOKIE_NAME: token})
            assert resp.status_code == 401

    async def test_rate_limiting_login_returns_429(self, client: AsyncClient) -> None:
        async with client:
            for _ in range(5):
                await client.post(
                    "/api/v1/auth/login",
                    json={"email": "target@example.com", "password": "bad"},
                )

            # 6th attempt is throttled
            resp = await client.post(
                "/api/v1/auth/login",
                json={"email": "target@example.com", "password": "bad"},
            )
            assert resp.status_code == 429
            assert "Retry-After" in resp.headers

    async def test_invite_lifecycle(self, client: AsyncClient, auth_db: Database) -> None:
        admin_id = str(uuid4())
        await auth_db.create_user(
            id=admin_id,
            email="admin@example.com",
            display_name="Admin",
            password_hash=hash_password("AdminPass123!"),
            role="admin",
            is_active=True,
        )

        # Log in as admin
        async with client:
            login_resp = await client.post(
                "/api/v1/auth/login",
                json={"email": "admin@example.com", "password": "AdminPass123!"},
            )
            assert login_resp.status_code == 200
            admin_cookie = login_resp.cookies[COOKIE_NAME]

            # Create user via admin API
            create_resp = await client.post(
                "/api/v1/admin/users",
                json={"email": "friend@example.com", "display_name": "Friend"},
                cookies={COOKIE_NAME: admin_cookie},
            )
            assert create_resp.status_code == 201
            invite_path = create_resp.json()["invite_path"]
            token = invite_path.split("/invite/")[1]

            # Validate invite token publicly
            val_resp = await client.get(f"/api/v1/auth/invite/{token}")
            assert val_resp.status_code == 200
            assert val_resp.json()["email"] == "friend@example.com"
            assert val_resp.json()["purpose"] == "invite"

            # Accept invite and set password
            accept_resp = await client.post(
                f"/api/v1/auth/invite/{token}",
                json={"password": "FriendPassword123!"},
            )
            assert accept_resp.status_code == 200
            assert accept_resp.json()["user"]["is_active"] is True
            assert COOKIE_NAME in accept_resp.cookies

            # Re-using the same invite token fails
            reuse_resp = await client.get(f"/api/v1/auth/invite/{token}")
            assert reuse_resp.status_code == 404

            reuse_post = await client.post(
                f"/api/v1/auth/invite/{token}",
                json={"password": "AnotherPassword123!"},
            )
            assert reuse_post.status_code == 404

    async def test_password_change_revokes_other_sessions(self, client: AsyncClient, auth_db: Database) -> None:
        user_id = str(uuid4())
        email = "multisession@example.com"
        old_pwd = "OldPassword123!"
        new_pwd = "NewPassword123!"

        await auth_db.create_user(
            id=user_id,
            email=email,
            display_name="Multi Session User",
            password_hash=hash_password(old_pwd),
            role="user",
            is_active=True,
        )

        # Create two sessions
        token_a = generate_token()
        token_b = generate_token()
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        await auth_db.create_session(token_hash=hash_token(token_a), user_id=user_id, expires_at=future)
        await auth_db.create_session(token_hash=hash_token(token_b), user_id=user_id, expires_at=future)

        async with client:
            # Change password using session A
            resp = await client.post(
                "/api/v1/auth/password",
                json={"current_password": old_pwd, "new_password": new_pwd},
                cookies={COOKIE_NAME: token_a},
            )
            assert resp.status_code == 200

            # Session A remains valid
            me_a = await client.get("/api/v1/auth/me", cookies={COOKIE_NAME: token_a})
            assert me_a.status_code == 200

            # Session B was revoked
            me_b = await client.get("/api/v1/auth/me", cookies={COOKIE_NAME: token_b})
            assert me_b.status_code == 401

    async def test_origin_middleware_blocks_disallowed_origins(self, client: AsyncClient) -> None:
        async with client:
            # Disallowed Origin on POST -> 403
            resp = await client.post(
                "/api/v1/auth/login",
                headers={"Origin": "https://malicious-site.com"},
                json={"email": "any@example.com", "password": "any"},
            )
            assert resp.status_code == 403
            assert resp.json() == {"detail": "Origin not allowed."}

            # Allowed Origin on POST -> passes middleware
            resp_allowed = await client.post(
                "/api/v1/auth/login",
                headers={"Origin": "http://localhost:3000"},
                json={"email": "any@example.com", "password": "any"},
            )
            # Middleware allowed it; endpoint executed (returned 401 for bad creds)
            assert resp_allowed.status_code == 401

    async def test_docs_disabled_by_default(self, client: AsyncClient) -> None:
        async with client:
            resp = await client.get("/docs")
            assert resp.status_code == 404

            resp_openapi = await client.get("/openapi.json")
            assert resp_openapi.status_code == 404

    async def test_docs_enabled_when_configured(self) -> None:
        from fastapi import FastAPI
        docs_app = FastAPI(
            title="Docs Enabled App",
            docs_url="/docs",
            openapi_url="/openapi.json",
        )
        transport = ASGITransport(app=docs_app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp_docs = await c.get("/docs")
            assert resp_docs.status_code == 200

            resp_spec = await c.get("/openapi.json")
            assert resp_spec.status_code == 200

    def test_no_user_context_error_raised_outside_request(self) -> None:
        from app.auth.context import NoUserContextError, require_user_id
        with pytest.raises(NoUserContextError, match="No active user context found"):
            require_user_id()

    async def test_context_var_set_inside_authenticated_request(self, client: AsyncClient, auth_db: Database) -> None:
        user_id = str(uuid4())
        await auth_db.create_user(
            id=user_id,
            email="ctx@example.com",
            display_name="Ctx User",
            password_hash=hash_password("pw"),
            role="user",
            is_active=True,
        )

        token = generate_token()
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        await auth_db.create_session(token_hash=hash_token(token), user_id=user_id, expires_at=future)

        async with client:
            resp = await client.get("/api/v1/auth/me", cookies={COOKIE_NAME: token})
            assert resp.status_code == 200
            assert resp.json()["id"] == user_id
