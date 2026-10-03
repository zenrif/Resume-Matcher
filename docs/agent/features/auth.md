# Authentication & Multi-User Architecture

> **Secure multi-user authentication system with sessions, Argon2id passwords, admin invites, and tenant isolation.**

## Overview

The authentication system introduces user identity, session management, role-based access control (`admin` and `user`), and per-user data tenancy to Resume Matcher while preserving backward compatibility for existing features.

Key characteristics:
- **Cookie-based sessions**: Server-side sessions identified by 32-byte cryptographically random hex tokens, hashed with SHA-256 before storage.
- **Argon2id password hashing**: Industry-standard Argon2id hashing with constant-time dummy verification on absent accounts to mitigate timing attacks.
- **Invite-only onboarding**: Admin-driven user creation generating single-use cryptographically random invite URLs with expiration.
- **Brute-force protection**: In-memory sliding window rate limiter tracking both per-IP and per-account failed login attempts.
- **Context isolation**: Thread-safe and async-safe `current_user_id` context variable populated on authenticated requests.
- **CSRF / Origin validation**: Enforced Origin checking on state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) with configured allowed origins.
- **Docs hardening**: Swagger UI (`/docs`), ReDoc (`/redoc`), and OpenAPI spec (`/openapi.json`) disabled by default in production, configurable via `RM_DOCS_ENABLED`.

---

## Data Models

Located in `apps/backend/app/models.py`:

### `User`
- `id` (PK, string UUID)
- `email` (unique, lowercase index)
- `display_name` (string)
- `password_hash` (Argon2id hash string, nullable until invite accepted)
- `role` (`admin` | `user`, default `user`)
- `is_active` (boolean, default `True`)
- `created_at`, `updated_at` (ISO 8601 UTC strings)

### `AuthSession`
- `token_hash` (PK, SHA-256 hex digest of the raw cookie token)
- `user_id` (foreign key to `users.id`, indexed)
- `created_at` (ISO 8601 UTC string)
- `expires_at` (ISO 8601 UTC string, default 30 days)

### `Invite`
- `token_hash` (PK, SHA-256 hex digest of raw invite token)
- `user_id` (foreign key to `users.id`, indexed)
- `purpose` (`invite` | `reset`, default `invite`)
- `created_at` (ISO 8601 UTC string)
- `expires_at` (ISO 8601 UTC string, default 7 days)
- `used_at` (ISO 8601 UTC string, null until claimed)

---

## Session Lifecycle & Cookies

1. **Token Generation**: On successful login or invite claim, a 32-byte (64 hex characters) cryptographic token is generated.
2. **Persistence**: Only `SHA256(token)` is stored in the database `sessions` table.
3. **Cookie Attributes**:
   - Name: `rm_session`
   - `HttpOnly`: True (inaccessible to JavaScript)
   - `SameSite`: `Lax`
   - `Path`: `/`
   - `Secure`: True if HTTPS or non-local; False during local development over HTTP (`settings.is_local_dev`).
4. **Validation & Resolution**:
   - `get_current_user` dependency in `app/auth/deps.py` reads `rm_session` cookie.
   - Computes SHA-256 hash and looks up active session joined with user record.
   - Rejects expired sessions and inactive users.
   - Binds `user.id` to `current_user_id` context variable.
5. **Logout**:
   - `POST /api/v1/auth/logout` deletes session from database and clears `rm_session` cookie (`Max-Age=0`).
6. **Password Change**:
   - `POST /api/v1/auth/password` revokes all active sessions for the user *except* the caller's current session token.

---

## API Endpoints

### Auth Router (`/api/v1/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/login` | Public | Authenticates credentials; sets `rm_session` cookie. Rate-limited. |
| `POST` | `/auth/logout` | Authenticated | Revokes current session and clears cookie. |
| `GET` | `/auth/me` | Authenticated | Returns current authenticated `UserResponse`. |
| `POST` | `/auth/password` | Authenticated | Changes password and revokes all other active sessions. |
| `GET` | `/auth/invite/{token}` | Public | Validates invite token and returns email/purpose. |
| `POST` | `/auth/invite/{token}` | Public | Claims invite, sets initial password, activates user, logs in. |

### Admin Router (`/api/v1/admin`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/admin/users` | Admin | Lists all user accounts. |
| `POST` | `/admin/users` | Admin | Creates an inactive user and returns invite URL with single-use token. |
| `POST` | `/admin/users/{id}/deactivate` | Admin | Deactivates user and terminates all active sessions. Cannot self-deactivate. |
| `POST` | `/admin/users/{id}/reactivate` | Admin | Reactivates an inactive user account. |
| `POST` | `/admin/users/{id}/reset-password` | Admin | Generates a single-use password reset link for the user. |

---

## CLI & Bootstrap

To create or reactivate the initial administrator account on an empty or existing database:

```bash
uv run python -m app.scripts.create_admin --email admin@example.com --name "System Admin"
```

The script creates the account in the database and outputs the full single-use invite link to claim and set the admin password.

---

## Security Mitigations

- **Timing Attacks**: `dummy_verify()` runs a real Argon2id hash check against a fixed dummy hash whenever an email does not exist, keeping response timing consistent with valid email lookups.
- **Login Rate Limiter**: 5 failed login attempts per email/IP within a 15-minute sliding window trigger HTTP 429 (`Retry-After: 900`).
- **CSRF Defense**: State-changing requests must present an `Origin` matching `RM_ALLOWED_ORIGINS` (defaults to `http://localhost:3000`).
