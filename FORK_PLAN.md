# FORK_PLAN.md — Multi-user fork of Resume Matcher

> **Audience:** AI coding agents (and the human owner reviewing them).
> **Base code:** `srbhr/Resume-Matcher` v1.3.0, commit `9c05e42` (2026-09-29), Apache-2.0.
> **Written:** 2026-10-02 from reading the code. Nothing in this plan has been executed or tested yet.
> **Line numbers** below are from commit `9c05e42`. If they drift, search by symbol name.

---

## 0. How to use this file (agent operating protocol)

1. Read this whole file before touching code.
2. Read the repo's own rules before each phase: `.claude/CLAUDE.md`, `apps/backend/CLAUDE.md`, `apps/frontend/CLAUDE.md`, `docs/agent/README.md`. They are plain markdown and apply to this fork unless this file says otherwise.
3. Work **one phase at a time** on a branch named `fork/phase-<n>-<slug>`. Make small commits. Do not start phase N+1 until phase N's "Done when" items pass.
4. Run the full test suites at the end of every phase (commands in §3). A phase is not done with a red suite.
5. **Never weaken an existing test.** Do not delete, skip, `xfail`, or loosen assertions. If an existing test breaks because of auth, fix it through fixtures (see §Phase 2, "Tests"). If that is impossible, stop and report.
6. **Stop and ask the owner** (do not guess) when:
   - you need a new dependency other than `argon2-cffi`;
   - you think `Dockerfile`, `.github/workflows/`, or CI must change;
   - you find a table, endpoint, or background job that touches user data and is not covered here;
   - a spike (Phase 0) disproves an assumption in this plan.
7. Prefer **new files** over editing upstream files. In upstream files, keep edits small and additive (one dependency line, one filter). This keeps future merges from `upstream` cheap.
8. When a task is finished, tick its checkbox in this file in the same commit.

### Starter prompt for the human to paste into the agent

```
Read FORK_PLAN.md fully, then the three CLAUDE.md files and docs/agent/README.md it references.
Start with Phase 0 only. Report results (baseline test counts and spike outcomes) before starting Phase 1.
Follow the operating protocol in section 0. Ask me before deviating from the plan.
```

---

## 1. Goal and decisions already made by the owner

Turn Resume Matcher (single-user, local-first, no auth) into **one deployment shared by the owner and a few non-technical friends** (≤ ~10 people). Each person has their own account and their own data. Indonesian is the primary language.

Decided by the owner (do not re-litigate):

| Topic | Decision |
|---|---|
| Approach | Fork Resume Matcher; change as little as possible; keep merging from upstream |
| Tenancy | One deployment, authentication (not one container per friend) |
| Accounts | Invite-only. Owner is the only admin. No public signup, no email/SMTP, no OAuth |
| Login | Server-side sessions in an HttpOnly cookie. Passwords hashed with argon2id |
| Data isolation | `user_id` column on document tables; current user carried in a `ContextVar` and read inside `database.py` |
| LLM key | One key, owned by admin, admin-only to view/change. Friends are limited by a daily AI quota |
| Language | Content language per account (default Indonesian). UI gets an `id` locale |
| Templates | No new template. Default `swiss-single` (single column, A4) already exists |

### Open decisions (ask the owner, defaults in brackets)

- Hosting: VPS or home server? Domain + HTTPS reverse proxy available? [assume yes, Caddy]
- Default daily AI quota per friend [30 operations/day]
- Form of address in the Indonesian UI [formal "Anda"]

### Non-goals

Public signup, email delivery, social login, per-user LLM keys, Postgres, multi-worker uvicorn, photo/date-of-birth fields on resumes (the `PersonalInfo` schema has none), rewriting the improve/diff pipeline, changing the Swiss design system.

---

## 2. Repo facts you need (verified by reading the code at `9c05e42`)

### Stack and layout

- Backend: FastAPI 0.128, Python 3.13, SQLAlchemy 2 async + aiosqlite (SQLite, WAL, `foreign_keys=ON`), LiteLLM, Playwright/Chromium for PDF. Package manager `uv`. Dependencies are exact pins in `apps/backend/pyproject.toml`; `uv.lock` is gitignored.
- Frontend: Next.js 16, React 19, Tailwind v4, strict TypeScript. Swiss International Style is mandatory for all UI.
- One container runs both. Browser → Next (`/api/*` rewrites in `apps/frontend/next.config.ts`) → FastAPI on `127.0.0.1:8000`. Same-origin from the browser's point of view.
- **Single uvicorn worker assumption**: caches, locks, and the in-memory stores assume one process. Do not add cross-worker state.
- `data/` (docker volume `resume-data`): `resume_matcher.db`, `config.json` (non-secret config), `.secret_key` (Fernet key for encrypted API keys), `uploads/`.

### Where things are

| Concern | Location |
|---|---|
| App wiring, lifespan, CORS | `apps/backend/app/main.py` (CORS at L100–106, `allow_credentials=True`; routers mounted L109–115 under `/api/v1`) |
| ORM models | `apps/backend/app/models.py` — `Resume, Job, Improvement, TailoringPreview, Application, ApiKey` |
| Schema migrations | `apps/backend/app/db_engine.py::init_models_sync` — `create_all` + idempotent `ALTER TABLE` pattern |
| DB facade | `apps/backend/app/database.py` (~1312 lines). Global singleton `db`. Returns plain dicts. `MAX_MASTER_RESUMES = 5` at L60 |
| Settings | `apps/backend/app/config.py` (`settings`, config.json helpers, encrypted key store) |
| Content language | `apps/backend/app/config_cache.py::get_content_language()` — reads global config. 12 call sites (3 in `services/resume_wizard.py`, 6 in `routers/resumes.py`, 3 in `routers/enrichment.py`) |
| Routers | `apps/backend/app/routers/{resumes,jobs,applications,enrichment,resume_wizard,config,health}.py`, mounted via `routers/__init__.py`. `resumes.py` is 2672 lines |
| PDF | `apps/backend/app/pdf.py` (Playwright; already has browser admission/lifecycle handling) |
| Draft tokens (pattern to copy) | `apps/backend/app/services/page_fit.py::RenderDraftStore` (in-memory, TTL 120 s, uuid4 hex, `put/get/discard`) |
| Print pages (server components) | `apps/frontend/app/print/resumes/[id]/page.tsx` (fetch at L83–85), `apps/frontend/app/print/cover-letter/[id]/page.tsx` (fetch at L41) |
| API client | `apps/frontend/lib/api/client.ts` (`apiFetch`; no auth handling today) |
| App shell | `apps/frontend/app/(default)/layout.tsx` (provider chain: `StatusCacheProvider → LanguageProvider → ResumePreviewProvider → LocalizedErrorBoundary`) |
| Settings page | `apps/frontend/app/(default)/settings/page.tsx` (1528 lines) |
| i18n | `apps/frontend/i18n/config.ts` (7 locales: `en es zh ja pt fr ko`), `lib/i18n/messages.ts` (`type Messages = typeof en` → every locale JSON must match `en.json` exactly or `next build` fails), `messages/*.json` (853 leaf strings each), `scripts/check_locale_parity.py`, `tests/i18n-locale-parity.test.ts` |
| Templates | `TemplateType` in `apps/frontend/lib/types/template-settings.ts`: `swiss-single`, `swiss-two-column`, `modern`, `modern-two-column`, `latex`, `clean`, `vivid`. Default `swiss-single`, `pageSize: 'A4'` |

### Behaviours that matter for this work

- Resume pipeline: upload → LLM parse → `ResumeData` JSON → `/resumes/improve/preview` (keywords, diff-based tailoring, verification, refine) → `/resumes/improve/confirm`. Do not modify it.
- Master resume invariant: up to 5 resumes have `is_master=True`; at most one is `is_default_master` (partial unique index). `create_resume_atomic_master` counts and inserts inside one `BEGIN IMMEDIATE` transaction.
- LLM config and API keys are **global** (`config.json` + encrypted `api_keys` table). They stay global and become admin-only.
- Background cleanup uses `asyncio.create_task` in `routers/resumes.py` (~L823–936).
- Repo rules: type hints on every Python function; log details server-side and return generic messages to clients; `copy.deepcopy` for mutable defaults; mount routers through `routers/__init__.py`; update the relevant `docs/agent/` doc when schemas/prompts/behaviour change; frontend: Swiss style (`rounded-none`, 1px black borders, hard shadows, project color tokens), no `app/api/` routes (they shadow the proxy), all backend calls through `lib/api/*`, print pages stay server components, every `en.json` key mirrored in all locale files, run `npm run lint` and `npm run format`.
- Do not modify `.github/workflows/`, `Dockerfile` build behaviour, or remove/disable existing tests.

---

## 3. Commands

```bash
# Backend (from apps/backend)
uv sync --extra dev
uv run pytest                                  # LLM evals excluded by default
uv run pytest -m eval                          # LLM-judge evals (needs a real key; do not run in CI-like loops)
uv run uvicorn app.main:app --reload --port 8000
uv run playwright install chromium             # once, for PDF tests

# Frontend (from apps/frontend)
npm install
npm run dev                                    # :3000
npm run test                                   # vitest
npm run lint && npm run format
npm run build                                  # runs tsc; locale drift fails here

# Repo root
git config core.hooksPath .githooks            # pre-push runs pytest + locale parity
python scripts/check_locale_parity.py          # confirm exact path/usage in .githooks/README.md
```

---

## 4. Security invariants (must all hold when the work is finished)

- [ ] **I1** No query on `resumes`, `jobs`, `improvements`, `tailoring_previews`, or `applications` runs without a user scope. Missing scope raises, it never falls through to "all rows".
- [ ] **I2** Another user's ID returns **404** (never 403) on every endpoint. Lists never include other users' rows.
- [ ] **I3** Session tokens and invite tokens are stored only as SHA-256 hashes. Plaintext exists only in the cookie / link.
- [ ] **I4** Cookie `rm_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` unless `AUTH_COOKIE_SECURE=false` (localhost only).
- [ ] **I5** Login errors are identical for unknown email and wrong password, and timing is equalised with a dummy hash verification.
- [ ] **I6** Print tokens are scoped to one user and one resume, valid for GET only, expire in 120 s, and are discarded after use.
- [ ] **I7** LLM config, API keys, features, and prompts can be **changed** only by admin. Users never see key material.
- [ ] **I8** Error responses to clients are generic. Details go to server logs. No password, token, or API key is ever logged (single exception: the one-time bootstrap invite link, see Phase 1).
- [ ] **I9** `/docs`, `/redoc`, `/openapi.json` are disabled in production.
- [ ] **I10** State-changing requests (`POST/PUT/PATCH/DELETE`) with an `Origin` header outside the allowed list are rejected with 403.

---

## Phase 0 — Baseline and spikes (≈ 2–3 h, risk: low)

- [x] **T0.1 Baseline.** Run both test suites untouched. Write the pass counts and the date into `docs/fork/BASELINE.md`. Tag `baseline-9c05e42`. If the baseline is red, stop and report.
- [x] **T0.2 Hooks.** `git config core.hooksPath .githooks`. Add `git remote add upstream https://github.com/srbhr/Resume-Matcher.git` (skip if present).
- [x] **T0.3 Spike: cookies through the Next proxy.** On a scratch branch, add a throwaway route that sets a cookie, and call it through Next (`http://localhost:3000/api/v1/<route>`). Confirm `Set-Cookie` reaches the browser/client and `Cookie` reaches FastAPI. Also log what `request.client.host` and `X-Forwarded-For` look like behind Next. **Delete the spike code afterwards** and record findings in `docs/fork/BASELINE.md`. If cookies do not pass, stop and report: the auth design depends on it.
- [x] **T0.4 Spike: Docker + PDF.** `docker compose build && docker compose up`; upload a resume; download a PDF. *(Diputuskan oleh owner: gunakan env lokal saja; Playwright Chromium terinstal lokal).*

**Done when:** baseline green and recorded, spike results recorded, scratch code removed.

---

## Phase 1 — Auth backend (≈ 8–10 h, risk: medium)

Do **not** scope existing data yet. Existing endpoints stay open in this phase; Phase 2 closes them.

### New files

| File | Purpose |
|---|---|
| `apps/backend/app/auth/__init__.py` | package |
| `apps/backend/app/auth/context.py` | `current_user_id: ContextVar[str \| None]`, `NoUserContextError` |
| `apps/backend/app/auth/passwords.py` | argon2id hash/verify, `dummy_verify()`, `needs_rehash` |
| `apps/backend/app/auth/sessions.py` | create / validate / revoke sessions; token = `secrets.token_urlsafe(32)`; store SHA-256 hex |
| `apps/backend/app/auth/deps.py` | `get_current_user`, `require_user`, `require_admin` |
| `apps/backend/app/auth/rate_limit.py` | `LoginRateLimiter` with an injectable clock |
| `apps/backend/app/routers/auth.py` | `/auth/*` routes |
| `apps/backend/app/routers/admin_users.py` | `/admin/users*` routes |
| `apps/backend/app/schemas/auth.py` | Pydantic request/response models |
| `apps/backend/app/scripts/create_admin.py` | CLI: `python -m app.scripts.create_admin --email X` creates/reactivates an admin and prints a fresh invite path |

### Edited files (additive)

- `app/models.py`: add `User`, `AuthSession` (`__tablename__ = "sessions"`; avoid clashing with SQLAlchemy's `Session`), `Invite`.
- `app/database.py`: **new methods only** for users/sessions/invites. Do not touch existing methods in this phase.
- `app/main.py`: include the two routers; create the bootstrap admin in `lifespan`; disable docs unless enabled; add the Origin-check middleware.
- `app/config.py`: new settings (see below).
- `app/routers/__init__.py`: export `auth_router`, `admin_users_router`.
- `apps/backend/pyproject.toml`: add `argon2-cffi` with an exact pin, in the style of the other pins.
- `apps/backend/.env.sample`: document the new variables.

### Tables

```text
users     id (uuid str, pk), email (unique, lowercased), display_name,
          password_hash (nullable until invite accepted),
          role ('admin' | 'user'), is_active (bool),
          content_language (default 'id'), daily_ai_limit (int, nullable = unlimited),
          created_at, last_login_at
sessions  token_hash (pk), user_id (-> users.id, ON DELETE CASCADE),
          created_at, expires_at, last_seen_at
invites   token_hash (pk), user_id (-> users.id, ON DELETE CASCADE),
          purpose ('invite' | 'reset'), expires_at, used_at
```

Use the repo's timestamp convention: ISO-8601 UTC strings (`_utcnow_iso` in `models.py`). Tables are created by `create_all`; no ALTER needed for new tables.

### Settings (env names are the upper-case form)

| Setting | Default | Notes |
|---|---|---|
| `auth_cookie_secure` | `True` | `False` only for localhost dev |
| `auth_session_days` | `30` | absolute lifetime; refresh `last_seen_at` at most once per 24 h |
| `admin_email` | `None` | used only for the bootstrap admin |
| `public_base_url` | falls back to `frontend_base_url` | used **only** to print the bootstrap invite link in the log |
| `default_daily_ai_limit` | `30` | applied to new non-admin users |
| `trust_proxy` | `False` | when true, use the left-most `X-Forwarded-For` entry for rate limiting |
| `invite_ttl_days` | `7` | |
| `min_password_length` | `10` | |
| `docs_enabled` | `False` | when false: `FastAPI(docs_url=None, redoc_url=None, openapi_url=None)` |

### Endpoints

| Route | Auth | Behaviour |
|---|---|---|
| `POST /api/v1/auth/login` `{email, password}` | public, rate-limited | 200 `{user}` + `Set-Cookie`. 401 `{"detail": "Invalid email or password."}` for any failure. 429 + `Retry-After` when limited. Inactive accounts also get the generic 401 |
| `POST /api/v1/auth/logout` | user | revoke current session, clear cookie, 204 |
| `GET /api/v1/auth/me` | user | `{id, email, display_name, role, content_language, daily_ai_limit, ai_used_today}` |
| `POST /api/v1/auth/password` `{current_password, new_password}` | user | verify current, set new, **revoke all other sessions** |
| `GET /api/v1/auth/invite/{token}` | public | validate token → `{email, display_name, purpose}` or 404 |
| `POST /api/v1/auth/invite/{token}` `{password}` | public, rate-limited | set password, mark invite used, activate user, create session (login) |
| `GET /api/v1/admin/users` | admin | list |
| `POST /api/v1/admin/users` `{email, display_name, role?, daily_ai_limit?}` | admin | create user + invite → `{user, invite_path}` where `invite_path` is `/invite/<token>` (the frontend prepends `window.location.origin`) |
| `POST /api/v1/admin/users/{id}/reset-link` | admin | new `purpose='reset'` invite → `{invite_path}`; revokes that user's sessions |
| `PATCH /api/v1/admin/users/{id}` `{is_active?, daily_ai_limit?, display_name?}` | admin | deactivating also revokes sessions |
| `DELETE /api/v1/admin/users/{id}` | admin | Phase 4 (deletes user and data). Refuse self-delete and deleting the last admin |

### Behaviour details

- **Dependencies must be `async def`.** A sync dependency runs in a worker thread with a copied context, so a `ContextVar.set()` inside it will **not** reach the endpoint. `get_current_user` is `async` and calls `current_user_id.set(user.id)`. Add a test that proves an endpoint sees the value.
- **Session lookup:** read cookie `rm_session` → SHA-256 → row must exist, be unexpired, and the user must be active. Otherwise 401 `{"detail": "Not authenticated."}`.
- **Bootstrap admin** (lifespan, after migrations): if `users` is empty and `ADMIN_EMAIL` is set, create an admin with `password_hash=NULL`, create an invite, and log **once**: `Bootstrap admin invite: {public_base_url}/invite/<token>`. If `users` is empty and `ADMIN_EMAIL` is unset, log a warning. If users exist, do nothing.
- **Origin middleware:** for `POST/PUT/PATCH/DELETE`, if `Origin` is present and not in `settings.effective_cors_origins`, return 403 `{"detail": "Origin not allowed."}`. If `Origin` is absent (curl, tests), allow; cookie auth still applies.
- **Login rate limit:** 5 failures per 15 min per `(ip, email)`, and 20 per 15 min per `ip`. In memory is fine (single worker). Inject the clock so tests need no sleeping.
- Add `docs/agent/features/auth.md` describing the model; update `docs/agent/apis/backend-requirements.md` (it currently says "Authentication: Currently none").

### Tests (new)

- `tests/unit/test_passwords.py`, `test_sessions.py`, `test_login_rate_limiter.py` (fake clock).
- `tests/integration/test_auth_api.py` (mark with `@pytest.mark.no_auth`, see Phase 2 fixture): login ok / wrong password / unknown email (same body) / inactive; logout revokes; expiry; 429; invite single-use; invite expiry; password change revokes other sessions; Origin check; `/docs` returns 404 when disabled; the ContextVar is visible inside an endpoint.

**Done when:** an invite link created by the bootstrap or CLI lets you set a password and log in; all new tests pass; all existing tests still pass; existing data endpoints are still open (by design, until Phase 2).

---

## Phase 2 — Per-user data isolation (≈ 8–12 h, risk: HIGH)

This phase decides whether the system is safe. Be exhaustive.

### Strategy

The current user is carried in `current_user_id` and read inside `Database`. Routers get a single dependency each; the ~80 `db.*` call sites in routers stay unchanged. Missing scope **fails closed**.

```python
# app/database.py (sketch; adapt helper names to the existing code)
class Database:
    def __init__(self, db_path: Path | None = None, fallback_user_id: str | None = None) -> None:
        ...
        self._fallback_user_id = fallback_user_id   # ONLY for tests; production db has None

    def _uid(self) -> str:
        uid = current_user_id.get() or self._fallback_user_id
        if uid is None:
            raise NoUserContextError("DB access without user scope")
        return uid

    async def get_resume(self, resume_id: str) -> dict[str, Any] | None:
        async with self._session() as session:
            row = await session.get(Resume, resume_id)
            if row is None or row.user_id != self._uid():
                return None                      # routers already map None -> 404
            return self._to_dict(row)
```

Rules for every method on the five document tables:
- **Create**: set `user_id = self._uid()`.
- **Read/list/count/exists**: add `.where(Model.user_id == self._uid())`.
- **Update/delete**: filter by primary key **and** `user_id`.
- `session.get(Model, pk)`: re-check `row.user_id` after fetching.
- Lookups by foreign key (improvements by `tailored_resume_id`, previews by `source_id`/`job_id`/`payload_hash`, applications by `job_id`/`resume_id`) must also filter `user_id`.
- Methods on `api_keys` stay global and unscoped.
- Outside a request, use **explicit-parameter maintenance methods** (`assign_orphan_rows(user_id)`, `delete_user_and_data(user_id)`) or `with db.acting_as(user_id):`. **Never** add an "unscoped" mode for document tables.

Enumerate methods with `grep -n "    async def " apps/backend/app/database.py`, classify each as document-scoped / global / maintenance, and keep the classification in the PR description.

### Tasks

- [ ] **T2.1 Models.** Add `user_id: Mapped[str | None]` (indexed, plain string, **no FK** to `users`) to `Resume`, `Job`, `Improvement`, `TailoringPreview`, `Application`. Change the model-level index to `Index("ux_resumes_default_master_per_user", "user_id", "is_default_master", unique=True, sqlite_where=text("is_default_master = 1"))`.
- [ ] **T2.2 Migration in `db_engine.py::init_models_sync`.**
  - Add `ALTER TABLE <t> ADD COLUMN user_id TEXT` for the five tables, using the existing idempotent `PRAGMA table_info` pattern. Add indexes `CREATE INDEX IF NOT EXISTS ix_<t>_user_id ON <t> (user_id)`.
  - **Critical:** the existing block (L91–94) runs `CREATE UNIQUE INDEX IF NOT EXISTS ux_resumes_single_default_master ON resumes (is_default_master) WHERE is_default_master = 1` on **every startup**. Remove that statement, add `DROP INDEX IF EXISTS ux_resumes_single_default_master`, and create the per-user index:
    ```sql
    DROP INDEX IF EXISTS ux_resumes_single_default_master;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_resumes_default_master_per_user
      ON resumes (user_id, is_default_master) WHERE is_default_master = 1;
    ```
    If this is missed, the second user cannot have a default master (IntegrityError).
  - Make the "promote earliest master when none is default" UPDATE (L86–90) per-user.
  - Do **not** backfill here: the admin does not exist yet at DDL time.
- [ ] **T2.3 Backfill.** In `main.py` lifespan, right after the bootstrap admin is created, call `db.assign_orphan_rows(admin_id)` which sets `user_id` on every row where it is NULL, across the five tables. Idempotent.
- [ ] **T2.4 `database.py` scoping.** Apply the rules above to every document method (resume, job, preview, improvement, application, stats). Specifics:
  - `create_resume_atomic_master` (~L300–342): count masters **for this user** inside the existing `BEGIN IMMEDIATE` transaction. `MAX_MASTER_RESUMES = 5` becomes per user.
  - `set_default_master_resume`, `delete_resume` (default promotion), `claim/finish_resume_processing`: per user.
  - `get_stats`: per user (it backs `/status` database stats).
  - Add `reset_user_data()` (deletes the caller's rows from the five tables; does **not** wipe `data/uploads` — nothing else writes there). Keep `reset_database()` for the CLI/tests only.
- [ ] **T2.5 Router gating.** For `resumes`, `jobs`, `applications`, `enrichment`, `resume_wizard`: `router = APIRouter(..., dependencies=[Depends(require_user)])` (one line each). `health.py`: keep `GET /health` public; add `Depends(require_user)` to `GET /status`.
  - **Exemption:** `GET /resumes/render-drafts/{token}` (resumes.py L1176) must stay reachable by the Next print page without a cookie (the unguessable draft token is its credential). Implement an explicit exemption list in `deps.py` containing exactly that path prefix, and add a test that pins the list.
- [ ] **T2.6 Content language per user.** `config_cache.get_content_language()` returns the active user's `content_language` (from the request-scoped user object / ContextVar), and falls back to the global config value when there is no user (scripts, tests). **The 12 call sites must not change.** `GET/PUT /config/language` read/write `users.content_language` (validate against `SUPPORTED_LANGUAGES`, routers/config.py L294).
- [ ] **T2.7 Background tasks.** `asyncio.create_task` copies the context at creation, so cleanup tasks created inside a request keep the user scope. Prove it with a test. Any code path that runs outside a request and touches documents must use a maintenance method or `acting_as`.

### Tests

- **Fixtures (additive, in `tests/conftest.py`):**
  - `isolated_backend_state` builds `Database(db_path=...)`; pass `fallback_user_id="test-user"` there so direct `db.*` calls in existing unit/integration tests keep working. Production `db = Database()` has no fallback.
  - Autouse fixture `authenticated_user` sets `app.dependency_overrides[get_current_user]` to an **async** override that sets `current_user_id` to `"test-user"` and returns an admin user object, and removes the override afterwards. Tests marked `@pytest.mark.no_auth` skip it. Register the marker in `pyproject.toml` (`--strict-markers` is on).
  - Existing tests that `patch("app.routers.X.db", new_callable=AsyncMock)` keep working because router-level dependencies still resolve through the override.
- **`tests/integration/test_multi_user_isolation.py`:** two users A and B. Parametrize over resource kinds (resume, job, application, improvement, preview) × operations (get, list, patch, delete, pdf, retry-processing, cover-letter/outreach/title, improve preview/confirm, enrichment, wizard). B using A's IDs must get 404 or an empty list. A's data is unchanged afterwards.
- **`tests/integration/test_migration_multiuser.py`:** a legacy DB (no `user_id`, old global index) is migrated; rows are backfilled to the admin; the old index is gone; two users can each hold a default master; the 5-master cap is per user.
- Background-task test (T2.7). Exemption-list pin test (T2.5).

**Done when:** I1 and I2 hold; the isolation matrix passes; all pre-existing tests pass **unmodified**; a second account can upload, set a default master, and tailor without touching the first account's data.

---

## Phase 3 — PDF and print pages (≈ 4–6 h, risk: medium)

Why: Chromium loads the Next `/print/*` server components, which call the backend without browser cookies. After Phase 2 those calls get 401 unless they carry a short-lived ticket.

### Tasks

- [ ] **T3.1 `apps/backend/app/services/print_tokens.py`** — model it on `RenderDraftStore`:
  ```python
  @dataclass(frozen=True)
  class PrintGrant:
      user_id: str
      resume_id: str

  class PrintTokenStore:
      def __init__(self, ttl_seconds: float = 120.0, max_entries: int = 64,
                   clock: Callable[[], float] = time.monotonic) -> None: ...
      def put(self, *, user_id: str, resume_id: str) -> str: ...      # uuid4 hex
      def get(self, token: str) -> PrintGrant | None: ...
      def discard(self, token: str) -> None: ...

  print_tokens = PrintTokenStore()
  ```
- [ ] **T3.2 `deps.get_current_user` fallback.** If there is no valid session cookie **and** header `X-Print-Token` is present **and** the request is `GET /api/v1/resumes` **and** the query `resume_id` equals the grant's `resume_id` **and** the grant's user is active → set `current_user_id` to the grant's user and continue. Anything else → 401.
- [ ] **T3.3 Mint tickets in the PDF endpoints** in `routers/resumes.py`: `download_resume_pdf` (~L2050) and `download_cover_letter_pdf` (~L2634). Create a grant for `(current user, resume_id)`, append `rt=<token>` to the print URL, and `discard` it in a `finally` block.
- [ ] **T3.4 Frontend print pages.** In `app/print/resumes/[id]/page.tsx` (fetch at L83–85) and `app/print/cover-letter/[id]/page.tsx` (fetch at L41): read `rt` from `searchParams` and pass it as header `X-Print-Token` **only when present**. Do not add `'use client'`. Do not wrap print pages in any provider.
- [ ] **T3.5** Draft page counting (`services/page_fit.py::measure_page_count`) uses the existing draft token and needs **no** ticket. Leave it alone, but confirm it still works with the router gate exemption from T2.5.

### Tests

- New `tests/integration/test_print_token.py`: ticket for resume A cannot fetch resume B; expired ticket → 401; ticket rejected for non-GET and for any other path; ticket for a deactivated user → 401; `PrintTokenStore` TTL/eviction with a fake clock.
- Existing `tests/integration/test_pdf_*.py` stay green.

**Done when:** PDF for a resume, PDF for a cover letter, and automatic page counting all work in a Docker build with auth on; I6 holds.

---

## Phase 4 — Admin gating, AI quota, data deletion (≈ 4–6 h, risk: low)

- [ ] **T4.1 Admin-only config endpoints** (`routers/config.py`): add `dependencies=[Depends(require_admin)]` to exactly these 10:
  `GET /llm-api-key`, `PUT /llm-api-key`, `POST /llm-test`, `PUT /features`, `PUT /prompts`, `PUT /feature-prompts`, `GET /api-keys`, `POST /api-keys`, `DELETE /api-keys`, `DELETE /api-keys/{provider}`.
  Plain-user reads (`GET /features`, `/prompts`, `/feature-prompts`, `/language`) stay available to any logged-in user.
- [ ] **T4.2 `POST /config/reset`** (L649): now requires only `require_user` and calls `db.reset_user_data()` (the confirmation body `{"confirm": "RESET_ALL_DATA"}` is unchanged). It deletes the **caller's** data only. Update its comment and the UI label ("delete all my data").
- [ ] **T4.3 Quota.** `app/auth/quota.py` with table `ai_usage (user_id, day TEXT 'YYYY-MM-DD' in Asia/Jakarta, count INT, PRIMARY KEY (user_id, day))` (add `AiUsage` to `models.py`) and dependency `consume_ai_quota`. Use one atomic upsert so concurrent requests cannot overshoot the limit:
  ```sql
  INSERT INTO ai_usage (user_id, day, count) VALUES (:u, :d, 1)
  ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1 WHERE count < :limit
  RETURNING count;
  ```
  No row returned → HTTP 429 using the repo's existing error-body helper (`operation_error_content` in `app/ai_budget.py`) with `code: "ai_quota_exceeded"`. `users.daily_ai_limit IS NULL` means unlimited (admins default to NULL). A failed operation still counts (simple, conservative). One operation = one request to an AI endpoint, not one LLM call.
  Apply `Depends(consume_ai_quota)` to every endpoint that calls an LLM — confirm each by grepping the service calls: resume upload (parse), `improve/preview`, `improve`, `retry-processing`, the three generate endpoints (cover letter, outreach message, title), `enrichment` analyze/enhance/regenerate, `resume-wizard` turn/finalize. Do **not** put it on `improve/confirm` or `apply*` endpoints if they make no LLM call.
  Include `ai_used_today` in `GET /auth/me`.
- [ ] **T4.4 Delete user.** `DELETE /admin/users/{id}`: one transaction deleting the user's rows in the five document tables, `ai_usage`, sessions, invites, then the user. Refuse self-delete and deleting the last admin.

### Tests

`test_admin_gating.py` (non-admin → 403 on each of the 10 endpoints; admin → 200; user can still read the 4 read endpoints); `test_quota.py` (limit reached → 429; day rollover with a fake clock; NULL limit unlimited; concurrent requests do not exceed the limit); reset/delete only affect the intended user.

**Done when:** I7 holds; quota and deletion behave as specified.

---

## Phase 5 — Frontend (≈ 8–10 h, risk: medium)

All new UI follows Swiss International Style (read `docs/portable/swiss-design-system/*` first). Run `npm run lint`, `npm run format`, `npm run test`, `npm run build`.

### New files

| File | Purpose |
|---|---|
| `apps/frontend/app/(auth)/login/page.tsx` | login form (own minimal layout; no app providers) |
| `apps/frontend/app/(auth)/invite/[token]/page.tsx` | set password from an invite/reset link (validate token first) |
| `apps/frontend/lib/api/auth.ts` | `login, logout, me, changePassword, validateInvite, acceptInvite`, admin user calls (`listUsers, createUser, resetLink, patchUser, deleteUser`) |
| `apps/frontend/lib/context/auth-context.tsx` | `AuthProvider`, `useAuth()` → `{ user, isAdmin, loading, refresh, logout }` |
| `apps/frontend/components/settings/account-section.tsx` | change password, remaining quota, "delete all my data" |
| `apps/frontend/components/settings/users-admin-section.tsx` | list users, invite, copy link, deactivate, set quota, delete (admin) |

### Edited files (keep diffs small)

- `app/(default)/layout.tsx`: wrap the existing provider chain with `AuthProvider`; do not render children until `/auth/me` resolves; on 401 redirect to `/login?next=<path>`.
- `lib/api/client.ts`: in `apiFetch`, when running in the browser and the response is 401 and the endpoint does **not** start with `/auth/`, redirect to `/login?next=<current path>`. Do nothing on the server. (`/auth/login` returning 401 means "wrong password", not "expired session".)
- `app/(default)/settings/page.tsx` (1528 lines): hide LLM provider/model/key, per-provider keys, features, prompts, and any global-reset UI for non-admins using `useAuth().isAdmin`; add the two new sections. Touch as little as possible.
- The existing navigation/header component: show the user's email and a logout button (find the file by searching `components/` for the nav).
- `messages/*.json`: new key trees `auth.*`, `settings.account.*`, `settings.users.*`, `errors.quota`.

### Rules and traps

- **Locale parity.** `type Messages = typeof en` means a new `en.json` key missing from any other locale fails `next build`. For new keys: write real text in `en` and `id`; in `es zh ja pt fr ko` copy the English text with a small throwaway script (so the build passes), then run `scripts/check_locale_parity.py` and `npm run test`.
- **Open redirect:** only accept a `next` value that starts with a single `/` (reject `//` and absolute URLs).
- Do not create `app/api/` routes (they shadow the proxy).
- Print pages stay server components and are not wrapped by `AuthProvider`.
- All backend calls go through `lib/api/*`.
- Client-side gating is a UX convenience; enforcement is in the backend.

### Tests (vitest)

`api-client` redirects on 401 (not for `/auth/*`, not on the server); `AuthProvider` redirects when `/auth/me` is 401; `next` validation; locale parity.

**Done when:** from an empty browser profile you can open an invite link, set a password, use upload → tailor → PDF → tracker, log out, and log back in; a non-admin sees no admin sections in Settings.

---

## Phase 6 — Indonesian (≈ 9–15 h, risk: low)

Do **6a before the first release**; 6b–6d can follow.

### 6a. Content language `id` (≈ 1–2 h)

- [ ] `apps/backend/app/prompts/templates.py`: add `"id": "Indonesian (Bahasa Indonesia)"` to `LANGUAGE_NAMES`.
- [ ] `apps/backend/app/routers/config.py` L294: add `"id"` to `SUPPORTED_LANGUAGES`.
- [ ] `apps/backend/app/schemas/models.py` L813: add `"id"` to the `supported_languages` default.
- [ ] `apps/backend/app/services/resume_wizard_copy.py`: add an `"id"` entry to `_COPY` (keys: `intro, contact, summary, workExperience, internships, education, personalProjects, skills, review, next, warning_name, warning_contact, warning_experience, warning_education, warning_skills`). Without it the wizard falls back to English.
- [ ] `apps/frontend/lib/api/config.ts` L250: add `'id'` to `SupportedLanguage`.
- [ ] Test: every prompt containing `{output_language}` formats successfully with the new language name.

### 6b. UI locale `id.json` (≈ 4–6 h)

- [ ] Follow the 7-step checklist in `docs/agent/features/i18n.md`, **plus** the places it omits (`schemas/models.py`, `resume_wizard_copy.py`, `lib/api/config.ts`, `tests/i18n-locale-parity.test.ts` `LOCALES`, `scripts/check_locale_parity.py`, `i18n/config.ts` names/flags). The docs say 5 locales; the code has 7 — **trust the code**.
- [ ] Translate `messages/en.json` leaf by leaf into `messages/id.json`: identical structure, keep `{placeholders}` exactly, formal "Anda" (unless the owner chose otherwise), keep common English loanwords (CV, ATS, API key, LLM) where Indonesian usage keeps them.
- [ ] Do it in chunks (the file has 853 leaf strings) and run the parity test after each chunk. Flag uncertain translations in the PR description for human review.
- [ ] Ensure the resume-heading keys used by the print pages (`translate(locale, key)` in `lib/i18n/server.ts`) exist in `id.json`.
- [ ] Update `docs/agent/features/i18n.md` and the locale list in the `CLAUDE.md` files if the owner agrees.

### 6c. Prompts and anti-fabrication (≈ 3–5 h)

- [ ] Do **not** rewrite the English prompts. First measure: tailor 3 real Indonesian resumes against 3 real job posts with the owner's model, and record problems.
- [ ] `apps/backend/app/prompts/refinement.py`: `AI_PHRASE_BLACKLIST` is English-only. Add an Indonesian list and select it when the content language is `id` (inspect how `refiner.py` uses the list). Propose the phrase list in the PR description for owner approval; start small and conservative.
- [ ] Add an eval-style structural test in `tests/evals/` (no LLM judge): given a master resume and a tailored result in Indonesian, assert no new employer names, job titles, degrees, institutions, or numeric figures appear that are absent from the master. Reuse existing scorers and `CRITICAL_TRUTHFULNESS_RULES` where possible.

### 6d. ATS check (≈ 1–2 h)

- [ ] Default template is already `swiss-single`, `A4` (`lib/types/template-settings.ts` ~L61–62). Do not change it.
- [ ] Add a test that renders a sample resume to PDF through the existing pipeline (follow `tests/integration/test_pdf_render.py`, including its skip behaviour when Chromium is unavailable), extracts text with `pdfminer.six` (already a dependency), and asserts reading order and that key strings are present.

**Done when:** content language `id` works end to end; UI is fully Indonesian with parity tests green; the anti-fabrication test and ATS test pass; the owner has read real outputs.

---

## Phase 7 — Deployment and operations (≈ 3–5 h, risk: medium)

Edit `docker-compose.yml` and `apps/backend/.env.sample`. **Do not edit `Dockerfile` or `.github/workflows/`.**

```yaml
services:
  resume-matcher:
    ports:
      - "127.0.0.1:${PORT:-3000}:3000"        # reachable only through the reverse proxy
    environment:
      - AUTH_COOKIE_SECURE=true
      - AUTH_SESSION_DAYS=30
      - ADMIN_EMAIL=owner@example.com
      - PUBLIC_BASE_URL=https://cv.example.com
      - DEFAULT_DAILY_AI_LIMIT=30
      - TRUST_PROXY=true
      - CORS_ORIGINS=["https://cv.example.com"]
      # FRONTEND_BASE_URL stays http://localhost:3000 so Chromium inside the container
      # calls Next locally (option A below)
```

- **`FRONTEND_BASE_URL` — pick one after testing on the real server.** Option A (recommended): keep `http://localhost:3000` and put the public domain in `CORS_ORIGINS` (it feeds the Origin check). Option B (what upstream's compose comment suggests): set it to the public domain; this makes Chromium go out and back in through the proxy and depends on hairpin NAT working on the host.
- **HTTPS:** reverse proxy with automatic TLS, e.g. Caddy:
  ```
  cv.example.com {
      reverse_proxy 127.0.0.1:3000
  }
  ```
  Upstream's compose publishes port 3000 on all interfaces; the `127.0.0.1:` binding above is required, otherwise the app is also reachable over plain HTTP.
- **Backup:** the volume holds `resume_matcher.db`, `config.json`, and `.secret_key`. Without `.secret_key` the encrypted API keys are unrecoverable, so back up all three. A consistent copy of the live SQLite file (the image has no `sqlite3` CLI):
  ```bash
  docker compose exec resume-matcher python -c "import sqlite3; s=sqlite3.connect('/app/backend/data/resume_matcher.db'); d=sqlite3.connect('/app/backend/data/backup.db'); s.backup(d)"
  ```
  Schedule it from the host and copy the result off the server. Test a restore once. (Verify the in-container Python path works before documenting it.)
- **Upstream updates:** `git fetch upstream && git merge upstream/main`, resolve conflicts (likely in `database.py`, `routers/resumes.py`, `routers/config.py`, `settings/page.tsx`, `messages/*.json`), read upstream's release notes first, **check any new upstream table for `user_id` scoping**, run all tests, then `docker compose build`.
- Write `docs/fork/OPERATIONS.md`: environment variables, bootstrap flow, backup/restore, update routine, how to create/reset an admin via the CLI.

**Done when:** the app is reachable over HTTPS on the real domain; port 3000 is closed to the outside; PDF works on the production host; a backup was taken and restored successfully.

---

## 5. Release checklist (before inviting the first friend)

- [ ] All backend and frontend tests green, including the two-user isolation matrix
- [ ] `rm_session` cookie is `HttpOnly` and `Secure` when checked in browser devtools on the real domain
- [ ] From a non-admin account: `GET /api/v1/config/llm-api-key` → 403 and `/docs` → 404
- [ ] PDF of a resume and of a cover letter download from the **production** host
- [ ] Account A's IDs tried from account B on every main endpoint → always 404
- [ ] A spending cap is set in the LLM provider's dashboard (the quota is only a second fence)
- [ ] Backup ran and a restore was tested
- [ ] Port 3000 is not reachable from another network
- [ ] 3 real resumes × 3 real job posts tried in Indonesian and the outputs read by a human
- [ ] Friends were told (a) the admin can technically read their data, (b) resume text is sent to the LLM provider

---

## 6. Time estimates (rough, single developer, unmeasured)

| Phase | Hours |
|---|---|
| 0 Baseline and spikes | 2–3 |
| 1 Auth backend | 8–10 |
| 2 Data isolation | 8–12 |
| 3 PDF and print pages | 4–6 |
| 4 Admin, quota, deletion | 4–6 |
| 5 Frontend | 8–10 |
| 6 Indonesian (6a 1–2, 6b 4–6, 6c 3–5, 6d 1–2) | 9–15 |
| 7 Deployment | 3–5 |
| **Total** | **46–67** |

Recommended order: 0 → 1 → 2 → 3 → 4 → 5 → 6a → 7 → release → 6b–6d.

---

## 7. Known unknowns

- Whether `Set-Cookie` and `Origin` pass cleanly through the Next rewrite proxy, and what client IP the backend sees (Phase 0 spike).
- Whether Chromium inside the container can reach the public domain (hairpin NAT) if `FRONTEND_BASE_URL` is set to it (Phase 7 test).
- Whether upstream already has an open multi-user/auth PR worth reusing. This session could not read upstream issues; the owner should search for "auth" and "multi-user".
- Quality of Indonesian output depends on the chosen LLM; judge it with real documents, not assumptions.
- Legal: resume data is personal data (Indonesia's UU PDP). This plan is not legal advice.
