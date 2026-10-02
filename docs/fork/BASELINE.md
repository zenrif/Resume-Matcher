# Baseline and Spike Findings (Phase 0)

- **Date:** 2026-10-02
- **Base commit:** `9c05e423dfde44a5b4bb398d2dc7507194252ded`
- **Tag:** `baseline-9c05e42`
- **Environment:** Windows, Python 3.13.14 (`uv 0.12.0`), Node.js `v22.17.1` (`npm 11.4.2`)

---

## 1. Baseline Test Suites (Untouched)

### Frontend Suite (`apps/frontend`)
- **Command:** `npm run test`
- **Runner:** vitest
- **Test files:** 69 passed (69 total)
- **Tests:** 668 passed (668 total)
- **Failures:** 0
- **Status:** **GREEN**

### Backend Suite (`apps/backend`)
- **Command:** `uv run pytest`
- **Total collected:** 1185 items (2 deselected, 1183 selected)
- **Result (untouched):** 0 passed, 1172 errors, 11 skipped
- **Status:** **RED on Windows**

#### Root Cause Analysis for Backend Baseline on Windows
All 1172 errors are identical fixture setup errors originating in `apps/backend/tests/conftest.py::deny_external_network`:
```python
E tests.conftest.UnexpectedNetworkAccess: External network access blocked in deterministic backend tests
```
- In `conftest.py`, `deny_external_network` is an `autouse=True` fixture that monkeypatches `socket.socket.connect` to block all network calls.
- On Windows, Python's default `asyncio.ProactorEventLoop._make_self_pipe()` uses `socket.socketpair()`. Since Windows lacks native `AF_UNIX` support, Python stdlib `_fallback_socketpair` connects to localhost `127.0.0.1`.
- Because `conftest.py` blocked all socket connections unconditionally without an exemption for loopback/localhost (`127.0.0.1`), every single async test failed during event loop initialization.
- **Approved Fix Applied:** With user approval, loopback connections (`127.0.0.1` / `::1` / `localhost`) were exempted in `apps/backend/tests/conftest.py::deny_external_network` and `tests/integration/_temperature_request_probe.py::_block_external_io`:
  - **1165 tests passed**, 0 errors, 11 skipped, 2 deselected, 7 failed.
  - The 7 failures on Windows are exclusively OS-level differences:
    1. POSIX permissions assertions (`0o600` on Windows NTFS): `test_crypto.py::test_secret_file_created_with_600_perms`, `test_e2e_monitor_collect.py::test_failure_traceback_is_private...`, `test_monitor_servers.py::test_frontend_proxy_targets_the_owned_backend`.
    2. Synthetic server harness subprocess mock in `test_monitor_servers.py` calling `taskkill` where `env` key is absent in kwargs.
  - All real application modules, routers, database methods, and evals pass completely.

---

## 2. Git Configuration and Remotes (T0.2)

- Git hooks configured: `git config core.hooksPath .githooks` (Completed)
- Upstream remote verified: `upstream -> https://github.com/srbhr/Resume-Matcher.git` (Present)
- Baseline tag created: `git tag baseline-9c05e42 9c05e423dfde44a5b4bb398d2dc7507194252ded` (Completed)

---

## 3. Cookie & Next.js Proxy Spike (T0.3)

A throwaway test endpoint was mounted under `/api/v1/spike-cookie/set` and `/api/v1/spike-cookie/check` on FastAPI (:8000) and accessed through Next.js Turbopack dev server (:3000) via its `/api/:path*` rewrite proxy.

### Findings
1. **`Set-Cookie` delivery:**
   - FastAPI issued: `Set-Cookie: rm_spike_session=spike_token_12345; HttpOnly; Path=/; SameSite=lax`
   - The response from `http://localhost:3000/api/v1/spike-cookie/set` included the exact `set-cookie` header.
   - Result: **Passed**. `Set-Cookie` cleanly passes through Next.js proxy to the client.

2. **`Cookie` forwarding:**
   - Client sent `Cookie: rm_spike_session=spike_token_12345` to `http://localhost:3000/api/v1/spike-cookie/check`.
   - FastAPI received `request.cookies.get("rm_spike_session") == "spike_token_12345"`.
   - Result: **Passed**. `Cookie` cleanly reaches FastAPI through the Next.js proxy.

3. **Client IP & Header observation behind Next proxy:**
   - Without upstream reverse proxy headers:
     - `request.client.host`: `127.0.0.1`
     - `request.headers.get("x-forwarded-for")`: `None`
     - `request.headers.get("x-forwarded-host")`: `localhost:3000`
   - When client/reverse proxy supplies `X-Forwarded-For: 203.0.113.195`:
     - `x-forwarded-for` is preserved and passed to FastAPI as `"203.0.113.195"`.
     - `client_host` in uvicorn resolves to `"203.0.113.195"`.
   - `Origin` header (`http://localhost:3000`) is preserved and passed to FastAPI untouched.

All spike code was removed and the working tree returned to clean state.

---

## 4. Docker & PDF Spike (T0.4)

- **Docker Status:** `docker` is not installed or available in PATH on the host Windows environment.
- **Local PDF Environment:** Playwright Chromium headless shell was installed locally via `uv run playwright install chromium` (`v145.0.7632.6` at `C:\Users\Zen\AppData\Local\ms-playwright\chromium-1208`).
