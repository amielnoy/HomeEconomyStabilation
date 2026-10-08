# Cookie-Based Session Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a real signed-in browser session authenticate against the API by making the existing `he_session` cookie the one real auth mechanism, fixing the gap that currently blocks both cloud-sync and the Open Banking pilot from ever being exercised end to end by a real user.

**Architecture:** Extract the duplicated `_authenticated_client` logic in `server/app.py` and `server/open_banking_routes.py` into one shared `server/http_auth.py` helper that accepts a token from the `Authorization` header or the `he_session` cookie (header wins if both present). The frontend drops all token-in-JS plumbing and relies on the browser's automatic cookie handling (`credentials: 'include'`) instead. A minimal sign-in/sign-out UI and a tiny `/api/auth/session` status endpoint close the loop so a real user can actually reach a signed-in state.

**Tech Stack:** No new dependencies. Python/FastAPI server-side; vanilla `fetch` on the frontend.

**Spec:** [docs/superpowers/specs/2026-10-08-cookie-session-auth-design.md](../specs/2026-10-08-cookie-session-auth-design.md)

## Global Constraints

- The `he_session` cookie's `httpOnly=True, secure=True, samesite="lax"` properties do not change, anywhere. No token material becomes JS-readable as part of this work.
- `Authorization: Bearer` support is kept everywhere the cookie is now also accepted — the header wins when both are present. This is not a cookie-only migration.
- `connect`'s and `callback`'s own route logic (sandbox/licence gate, consent check, PKCE cookie handling, `OpenBankingRepository` calls) is not redesigned — only the auth *source* changes, from header-only to header-or-cookie.
- Out of scope, not touched by this plan: the open-banking consent-granting UI, the two parked Open Banking precision fixes (narrowing revoke-on-refusal to `invalid_grant` specifically; serializing concurrent syncs), and the NextGenPSD2/real-sandbox work.
- No automated test can exercise a real Google OAuth round trip in this environment — this plan's Final Verification has one manual step, same category as the Open Banking plan's unverified real-bank-sandbox gap.

## Review Focus

- A caller presenting neither an `Authorization` header nor a `he_session` cookie must get the exact same 401/403 behavior every affected route already gives today — prove the fallback doesn't accidentally widen who counts as authenticated. Tested in Task 1 (the helper itself) and re-proven in Tasks 2/3 (each route file's existing auth tests must keep passing unmodified in their assertions, only their monkeypatch target changes).
- When both an `Authorization` header and a `he_session` cookie are present and *differ*, the header must win — proven in Task 1.
- `callback`'s failure paths (state mismatch, exchange failure, connection-write failure, consent-check failure) must redirect to the landing page with an error code and clear all three PKCE cookies on every exit, never return a raw JSON body to what is, in a real browser, a top-level navigation — proven in Task 3.
- No response anywhere — including the new `/api/auth/session` — ever exposes the `he_session` cookie's value or any other token material. Proven in Task 2 (the new endpoint returns only a boolean).
- The frontend must never attempt to read `he_session` via `document.cookie` (it would silently always return `undefined`, masking a design mistake) — proven in Task 4 by asserting the browser client's requests carry `credentials: 'include'` and no `Authorization` header at all, and in Task 5 by removing every line that used to read a token into JS.

---

## File Structure

```
server/
  config.py              # MODIFY: extract session_token() out of bearer_token()
  http_auth.py            # CREATE: shared authenticated_client() + SESSION_COOKIE
  app.py                   # MODIFY: use the shared helper; add GET /api/auth/session;
                           #         redirect (not raw JSON) on Google sign-in failure
  open_banking_routes.py   # MODIFY: use the shared helper; redirect (not raw JSON) on
                           #         callback failure; clear PKCE cookies on every exit
fe/
  src/
    open-banking.ts        # MODIFY: drop accessToken param, use credentials: 'include'
    app.ts                 # MODIFY: delete currentAccessToken() stub; add sign-in/out UI
                           #         wiring; gate #btn-open-banking on sign-in state too;
                           #         handle ?openBankingError= on load
  mazan-habait.html         # MODIFY: add sign-in/sign-out button markup
  resources/
    he.json, en.json, am.json, fr.json   # MODIFY: add signIn/signOut strings
tests/
  server/
    test_config.py          # MODIFY: cover session_token()
    test_http_auth.py       # CREATE: cover the shared helper
    test_app.py              # MODIFY: migrate auth monkeypatches; cover /api/auth/session
                             #         and the Google callback's redirect-on-failure
    test_open_banking_routes.py  # MODIFY: migrate auth monkeypatches; cover callback's
                                  #         redirect-on-failure and cookie-clearing
  unit/
    open-banking.unit.test.ts    # MODIFY: cover credentials: 'include' instead of a token
  component/
    sign-in.component.test.ts    # CREATE: cover the sign-in/sign-out markup's default state
```

---

### Task 1: Shared auth helper

**Files:**
- Modify: `server/config.py`
- Create: `server/http_auth.py`
- Test: `tests/server/test_config.py`
- Test: `tests/server/test_http_auth.py`

**Interfaces:**
- Consumes: `SupabaseConfig`/`read_supabase_config` (existing, `server/config.py`), `SupabaseRestClient` (existing, `server/supabase_store.py`)
- Produces:
  - `server/config.py`: `session_token(value: str | None) -> str | None` (new, public — the same charset/non-empty check `bearer_token` already does, extracted so it can validate a cookie value too)
  - `server/http_auth.py`: `SESSION_COOKIE: str = "he_session"`, `async def authenticated_client(request: Request) -> tuple[SupabaseRestClient, str] | JSONResponse`

- [ ] **Step 1: Write the failing test for `session_token`**

Add to `tests/server/test_config.py`:

```python
from server.config import bearer_token, read_supabase_config, session_token


def test_session_token_applies_the_same_shape_check_bearer_token_does() -> None:
    assert session_token(None) is None
    assert session_token("") is None
    assert session_token("has a space") is None
    assert session_token("has\nnewline") is None
    assert session_token("valid.token-value_123~ok") == "valid.token-value_123~ok"
```

(Change the existing top-of-file import line from `from server.config import bearer_token, read_supabase_config` to the three-name import shown above.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/server/test_config.py -v`
Expected: FAIL with `ImportError: cannot import name 'session_token'`

- [ ] **Step 3: Extract `session_token` in `server/config.py`**

Replace the existing `bearer_token` function with:

```python
def bearer_token(header: str | None) -> str | None:
    if not header or not header.startswith("Bearer "):
        return None
    return session_token(header.removeprefix("Bearer "))


def session_token(value: str | None) -> str | None:
    if not value:
        return None
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._~-")
    return value if all(character in allowed for character in value) else None
```

This is behavior-preserving for `bearer_token` — same inputs produce the same outputs as before.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/server/test_config.py -v`
Expected: PASS (both the existing `test_bearer_token_parser_rejects_ambiguous_values` and the new test)

- [ ] **Step 5: Write the failing tests for the shared helper**

Create `tests/server/test_http_auth.py`:

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

import server.http_auth as http_auth_module
from server.http_auth import SESSION_COOKIE, authenticated_client

app = FastAPI()


@app.get("/probe")
async def probe(request: Request):
    result = await authenticated_client(request)
    if isinstance(result, JSONResponse):
        return result
    _client, user_id = result
    return {"userId": user_id}


client = TestClient(app)


class FakeAuthenticatedClient:
    def verify_user(self) -> str:
        return "user-1"


def test_refuses_when_supabase_is_not_configured(monkeypatch) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    response = client.get("/probe")
    assert response.status_code == 503
    assert response.json() == {"code": "cloud_not_configured"}


def test_refuses_when_neither_header_nor_cookie_is_present(monkeypatch) -> None:
    monkeypatch.setattr(http_auth_module, "read_supabase_config", lambda: object())
    response = client.get("/probe")
    assert response.status_code == 401
    assert response.json() == {"code": "authentication_required"}


def test_accepts_the_bearer_header(monkeypatch) -> None:
    monkeypatch.setattr(http_auth_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(http_auth_module, "SupabaseRestClient", lambda _config, _token: FakeAuthenticatedClient())
    response = client.get("/probe", headers={"Authorization": "Bearer header.token.value"})
    assert response.status_code == 200
    assert response.json() == {"userId": "user-1"}


def test_accepts_the_session_cookie_when_there_is_no_header(monkeypatch) -> None:
    monkeypatch.setattr(http_auth_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(http_auth_module, "SupabaseRestClient", lambda _config, _token: FakeAuthenticatedClient())
    response = client.get("/probe", cookies={SESSION_COOKIE: "cookie.token.value"})
    assert response.status_code == 200
    assert response.json() == {"userId": "user-1"}


def test_the_header_wins_when_both_are_present(monkeypatch) -> None:
    captured = {}

    def fake_client(_config, token):
        captured["token"] = token
        return FakeAuthenticatedClient()

    monkeypatch.setattr(http_auth_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(http_auth_module, "SupabaseRestClient", fake_client)
    response = client.get(
        "/probe",
        headers={"Authorization": "Bearer header.token.value"},
        cookies={SESSION_COOKIE: "cookie.token.value"},
    )
    assert response.status_code == 200
    assert captured["token"] == "header.token.value"


def test_rejects_an_unverifiable_session(monkeypatch) -> None:
    monkeypatch.setattr(http_auth_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(
        http_auth_module, "SupabaseRestClient",
        lambda _config, _token: type("Unverified", (), {"verify_user": lambda self: None})(),
    )
    response = client.get("/probe", cookies={SESSION_COOKIE: "cookie.token.value"})
    assert response.status_code == 401
    assert response.json() == {"code": "invalid_session"}
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `pytest tests/server/test_http_auth.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'server.http_auth'`

- [ ] **Step 7: Implement `server/http_auth.py`**

```python
from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .config import bearer_token, read_supabase_config, session_token
from .supabase_store import SupabaseRestClient

SESSION_COOKIE = "he_session"


def _error(status: int, code: str) -> JSONResponse:
    return JSONResponse({"code": code}, status_code=status)


async def authenticated_client(request: Request) -> tuple[SupabaseRestClient, str] | JSONResponse:
    config = read_supabase_config()
    if not config:
        return _error(503, "cloud_not_configured")
    token = bearer_token(request.headers.get("authorization")) or session_token(request.cookies.get(SESSION_COOKIE))
    if not token:
        return _error(401, "authentication_required")
    client = SupabaseRestClient(config, token)
    user_id = await run_in_threadpool(client.verify_user)
    if not user_id:
        return _error(401, "invalid_session")
    return client, user_id
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pytest tests/server/test_http_auth.py -v`
Expected: PASS (all 6 tests)

- [ ] **Step 9: Run the full server suite to confirm no regressions**

Run: `pytest tests/server -v`
Expected: PASS (`server/http_auth.py` is not imported by anything yet, so nothing existing is affected)

- [ ] **Step 10: Commit**

```bash
git add server/config.py server/http_auth.py tests/server/test_config.py tests/server/test_http_auth.py
git commit -m "feat(auth): shared authenticated_client helper, accepts a session cookie too"
```

---

### Task 2: Wire `server/app.py` to the shared helper

**Files:**
- Modify: `server/app.py`
- Test: `tests/server/test_app.py`

**Interfaces:**
- Consumes: `authenticated_client`, `SESSION_COOKIE` (Task 1, `server.http_auth`)
- Produces: `GET /api/auth/session -> {"signedIn": bool}`; `finish_google_sign_in`'s failure paths now redirect instead of returning JSON

- [ ] **Step 1: Migrate the existing auth monkeypatches to target the shared module**

In `tests/server/test_app.py`, add the import and change the `authenticate` helper:

```python
import server.http_auth as http_auth_module
```

(add this alongside the existing `import server.app as app_module` line)

```python
def authenticate(monkeypatch) -> None:
    monkeypatch.setattr(http_auth_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(http_auth_module, "SupabaseRestClient", lambda _config, _token: FakeAuthenticatedClient())
```

(replaces the two `app_module.*` lines inside `authenticate`)

- [ ] **Step 2: Run the full server suite to verify these tests now fail**

Run: `pytest tests/server/test_app.py -v`
Expected: FAIL — every test using `authenticate(monkeypatch)` now gets `503 cloud_not_configured` or `401`, because `app.py`'s own `_authenticated_client` still reads `app_module.read_supabase_config`/`app_module.SupabaseRestClient`, not `http_auth_module`'s. This confirms the test change is exercising the right thing before you make the implementation change.

- [ ] **Step 3: Replace `app.py`'s own `_authenticated_client` with the shared helper**

In `server/app.py`:
1. Add to the imports: `from .http_auth import SESSION_COOKIE, authenticated_client`
2. Delete the existing `_authenticated_client` function entirely (lines 61-72, the one reading `bearer_token(request.headers.get("authorization"))`).
3. Everywhere `_authenticated_client(request)` was called (the `/api/profile`, `/api/consents/cloud-sync`, `/api/snapshots` handlers, and anywhere else in this file), replace the call with `authenticated_client(request)`.
4. Delete the now-redundant `SESSION_COOKIE = "he_session"` line (it moved to `http_auth.py`) — the places that used `SESSION_COOKIE` (`_cookie(response, SESSION_COOKIE, ...)` in `finish_google_sign_in`, `response.delete_cookie(SESSION_COOKIE, path="/")` in `sign_out`) now resolve via the imported name.

- [ ] **Step 4: Run the tests to verify they pass again**

Run: `pytest tests/server/test_app.py -v`
Expected: PASS — all tests, including every `authenticate(monkeypatch)`-based test, now exercise the real wiring through `http_auth_module`.

- [ ] **Step 5: Write the failing test for `/api/auth/session`**

Add to `tests/server/test_app.py`:

```python
def test_auth_session_reports_signed_out_without_a_cookie_or_header(monkeypatch) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    response = client.get("/api/auth/session")
    assert response.status_code == 200
    assert response.json() == {"signedIn": False}


def test_auth_session_reports_signed_in_with_a_valid_cookie(monkeypatch) -> None:
    authenticate(monkeypatch)
    response = client.get("/api/auth/session", cookies={"he_session": "cookie.token.value"})
    assert response.status_code == 200
    assert response.json() == {"signedIn": True}


def test_auth_session_never_echoes_the_cookie_value() -> None:
    response = client.get("/api/auth/session", cookies={"he_session": "a-very-secret-token-value"})
    assert "a-very-secret-token-value" not in response.text
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pytest tests/server/test_app.py -v -k auth_session`
Expected: FAIL with 404 (no such route yet)

- [ ] **Step 7: Implement `GET /api/auth/session`**

Add to `server/app.py`, near the other `/api/auth/*` routes:

```python
@app.get("/api/auth/session")
async def auth_session(request: Request) -> Response:
    result = await authenticated_client(request)
    return JSONResponse({"signedIn": not isinstance(result, JSONResponse)})
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pytest tests/server/test_app.py -v -k auth_session`
Expected: PASS (all 3)

- [ ] **Step 9: Write the failing tests for the Google callback's redirect-on-failure**

Add to `tests/server/test_app.py`:

```python
def test_sign_in_state_mismatch_redirects_with_an_error_code_not_raw_json() -> None:
    response = client.get("/api/auth/callback?code=abc&state=xyz", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/mazan-habait.html?signInError=sign_in_state_mismatch"


def test_sign_in_exchange_failure_redirects_to_the_original_landing_target(monkeypatch) -> None:
    import httpx

    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(400, json={"error": "invalid_grant"}))
    callback_client = TestClient(app)
    callback_client.cookies.set("he_pkce", "verifier-value")
    callback_client.cookies.set("he_state", "state-value|/some-other-page.html")
    response = callback_client.get(
        "/api/auth/callback?code=abc&state=state-value", follow_redirects=False,
    )
    assert response.status_code == 302
    assert response.headers["location"] == "/some-other-page.html?signInError=sign_in_failed"
```

(`VERIFIER_COOKIE = "he_pkce"` and `STATE_COOKIE = "he_state"` are the real constant names, defined in `server/auth_flow.py` — confirm against that file before writing this test. The landing target is a plain path on purpose, to avoid any question of how a `#fragment` would round-trip through a cookie value — that's not what this test is checking.)

- [ ] **Step 10: Run the tests to verify they fail**

Run: `pytest tests/server/test_app.py -v -k redirect`
Expected: FAIL — both currently return a raw JSON body (`{"code": "sign_in_state_mismatch"}` / `{"code": "sign_in_failed"}`), not a redirect.

- [ ] **Step 11: Make `finish_google_sign_in` redirect instead of returning raw JSON on failure**

In `server/app.py`, replace the two early-return lines inside `finish_google_sign_in`:

```python
    if not verifier or not code or len(stored) != 2 or stored[0] != request.query_params.get("state"):
        return _error(400, "sign_in_state_mismatch")

    exchanged = await run_in_threadpool(_exchange_code, config, code, verifier)
    if exchanged is None:
        return _error(502, "sign_in_failed")
```

with:

```python
    if not verifier or not code or len(stored) != 2 or stored[0] != request.query_params.get("state"):
        return RedirectResponse(f"{_DEFAULT_LANDING}?signInError=sign_in_state_mismatch", status_code=302)

    exchanged = await run_in_threadpool(_exchange_code, config, code, verifier)
    if exchanged is None:
        landing = stored[1] if len(stored) == 2 else _DEFAULT_LANDING
        return RedirectResponse(f"{landing}?signInError=sign_in_failed", status_code=302)
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `pytest tests/server/test_app.py -v -k redirect`
Expected: PASS

- [ ] **Step 13: Run the full server suite**

Run: `pytest tests/server -v`
Expected: PASS, no regressions

- [ ] **Step 14: Commit**

```bash
git add server/app.py tests/server/test_app.py
git commit -m "feat(auth): wire app.py to the shared helper, add /api/auth/session, redirect on sign-in failure"
```

---

### Task 3: Wire `server/open_banking_routes.py` to the shared helper

**Files:**
- Modify: `server/open_banking_routes.py`
- Test: `tests/server/test_open_banking_routes.py`

**Interfaces:**
- Consumes: `authenticated_client`, `SESSION_COOKIE` (Task 1, `server.http_auth`)
- Produces: `callback`'s failure paths now redirect with `?openBankingError=<code>` and clear all three PKCE cookies on every exit, not only success

- [ ] **Step 1: Migrate the existing auth monkeypatches to target the shared module**

In `tests/server/test_open_banking_routes.py`, add `import server.http_auth as http_auth_module` beside the existing `import server.app as app_module` line, then replace every one of the three `monkeypatch.setattr(app_module, "read_supabase_config", ...)` / `monkeypatch.setattr(app_module, "SupabaseRestClient", ...)` pairs (in the `authenticate()` helper, and in the two inline blocks inside `test_connections_list_never_carries_a_token_field`-adjacent tests — search the file for every occurrence of `app_module` to find all of them) with the identical pattern targeting `http_auth_module` instead.

- [ ] **Step 2: Run the suite to verify these tests now fail**

Run: `pytest tests/server/test_open_banking_routes.py -v`
Expected: FAIL — every authenticated-route test, for the same reason as Task 2's Step 2 (the module's own `_authenticated_client` still reads through `app_module`, not `http_auth_module`).

- [ ] **Step 3: Replace `open_banking_routes.py`'s own `_authenticated_client` with the shared helper**

In `server/open_banking_routes.py`:
1. Change the import line `from .config import bearer_token` to `from .http_auth import SESSION_COOKIE, authenticated_client` (delete the `bearer_token` import entirely — the shared helper owns that logic now).
2. Delete the entire existing `_authenticated_client` function (the one with the `from . import app as app_module` lazy import inside it).
3. Replace every call site of `_authenticated_client(request)` in this file with `authenticated_client(request)`.

- [ ] **Step 4: Run the suite to verify it passes again**

Run: `pytest tests/server/test_open_banking_routes.py -v`
Expected: PASS — all existing tests, now exercising the real wiring through `http_auth_module`.

- [ ] **Step 5: Run the full server suite**

Run: `pytest tests/server -v`
Expected: PASS, no regressions (confirms Tasks 1-3 are mutually consistent)

- [ ] **Step 6: Write the failing tests for `callback`'s redirect-on-failure and cookie-clearing**

Add to `tests/server/test_open_banking_routes.py` (reuse whatever helper this file already has for setting up the PKCE cookies on `callback_client()` — read the existing callback tests near the top of the `callback` test section first to match the established cookie-setup pattern exactly):

```python
def test_callback_state_mismatch_redirects_instead_of_returning_raw_json() -> None:
    response = callback_client().get(
        "/api/open-banking/callback?code=abc&state=wrong", follow_redirects=False,
    )
    assert response.status_code == 302
    assert response.headers["location"] == "/mazan-habait.html?openBankingError=open_banking_state_mismatch"


def test_callback_clears_all_pkce_cookies_even_on_a_state_mismatch() -> None:
    response = callback_client().get(
        "/api/open-banking/callback?code=abc&state=wrong", follow_redirects=False,
    )
    set_cookie_headers = response.headers.get_list("set-cookie")
    for name in ("he_ob_state", "he_ob_pkce", "he_ob_source"):
        assert any(header.startswith(f"{name}=") and "Max-Age=0" in header for header in set_cookie_headers)
```

(`callback_client()` is whatever helper this test file already uses to build a `TestClient` with the PKCE cookies pre-set — reuse it exactly as the existing callback tests do, don't invent a new one. If the existing helper doesn't pre-set a *mismatched* state on purpose, call its underlying `TestClient` directly with the cookies you need for this specific "wrong state" scenario, following the same construction pattern.)

- [ ] **Step 7: Run the tests to verify they fail**

Run: `pytest tests/server/test_open_banking_routes.py -v -k "redirects_instead or clears_all"`
Expected: FAIL — the route currently returns raw JSON on state mismatch and does not clear cookies on that path.

- [ ] **Step 8: Make `callback` redirect and clear cookies on every exit**

In `server/open_banking_routes.py`'s `callback` function, the current shape is roughly:

```python
@router.get("/api/open-banking/callback")
async def callback(request: Request) -> Response:
    source_id = request.cookies.get(SOURCE_COOKIE)
    verifier = request.cookies.get(VERIFIER_COOKIE)
    state = request.cookies.get(STATE_COOKIE)
    code = request.query_params.get("code")
    if not source_id or not verifier or not state or not code or state != request.query_params.get("state"):
        return _error(400, "open_banking_state_mismatch")
    ...
```

Read the full current function body first (it has several more early-return `_error(...)` calls after the sandbox/licence gate, the token exchange, the auth check, and the connection-write), then restructure it so that:

1. A small local helper builds the redirect response and clears the three PKCE cookies on it:

```python
def _callback_exit(target: str, *, error: str | None = None) -> Response:
    url = f"{target}?openBankingError={error}" if error else target
    response = RedirectResponse(url, status_code=302 if error else response_status := 302)
    for cookie in (VERIFIER_COOKIE, STATE_COOKIE, SOURCE_COOKIE):
        response.delete_cookie(cookie, path="/")
    return response
```

(Simplify away the unused `response_status` walrus — it was a slip; just use `status_code=302` directly, since every exit from this route is a redirect now, success included.)

2. Replace every `return _error(STATUS, "open_banking_..._failed_or_whatever")` early-return inside `callback` with `return _callback_exit(_DEFAULT_LANDING_PATH, error="open_banking_..._failed_or_whatever")` — keep each error *code* string exactly as it already is today (do not rename any of them; only the response shape changes, from JSON to a redirect carrying the same code as a query param). Use the same default landing path constant this module already has available, or `"/mazan-habait.html"` directly if it doesn't define one — check `server/app.py`'s `_DEFAULT_LANDING` for the existing convention and either import it or inline the literal, matching whichever this module already does elsewhere.
3. Replace the final success path's existing `response = RedirectResponse("/mazan-habait.html", status_code=302)` plus its own manual `for cookie in (...): response.delete_cookie(...)` loop with `return _callback_exit(_DEFAULT_LANDING_PATH)` (no `error=`), since `_callback_exit` now does the cookie-clearing for every exit, success included — delete the now-duplicated manual cookie-clearing loop from the success path.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pytest tests/server/test_open_banking_routes.py -v`
Expected: PASS — including the existing success-path callback test (`test_callback_redirects_to_the_landing_page_and_clears_cookies` or whatever it's actually named — confirm it still passes with the refactored shared exit path) and the two new tests.

- [ ] **Step 10: Run the full server suite**

Run: `pytest tests/server -v`
Expected: PASS, no regressions

- [ ] **Step 11: Commit**

```bash
git add server/open_banking_routes.py tests/server/test_open_banking_routes.py
git commit -m "feat(open-banking): wire callback to the shared auth helper, redirect on every failure"
```

---

### Task 4: Frontend browser client drops token-in-JS plumbing

**Files:**
- Modify: `fe/src/open-banking.ts`
- Test: `tests/unit/open-banking.unit.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `OpenBankingClient`'s constructor no longer takes `accessToken`; every request carries `credentials: 'include'` instead of an `Authorization` header

- [ ] **Step 1: Rewrite the failing tests first**

Replace the full contents of `tests/unit/open-banking.unit.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest';
import { OpenBankingClient, OpenBankingError } from '../../fe/src/open-banking';

describe('open banking client', () => {
  it('builds the connect href from the source id, no fetch involved', () => {
    const client = new OpenBankingClient({ fetchImpl: vi.fn() as typeof fetch });
    expect(client.connectHref('hapoalim')).toBe('/api/open-banking/connect/hapoalim');
  });

  it('lists sources with the ambient cookie, not an explicit token', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ sources: [{ id: 'hapoalim', name: 'בנק הפועלים', kind: 'bank', mode: 'sandbox' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const client = new OpenBankingClient({ fetchImpl: fetchImpl as typeof fetch });

    const sources = await client.listSources();

    expect(sources).toEqual([{ id: 'hapoalim', name: 'בנק הפועלים', kind: 'bank', mode: 'sandbox' }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/open-banking/sources',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('sends the request with credentials and surfaces a 401 as a stable error', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init?.credentials).toBe('include');
      expect(init?.headers ?? {}).not.toHaveProperty('Authorization');
      return new Response(JSON.stringify({ code: 'authentication_required' }), { status: 401 });
    });
    const client = new OpenBankingClient({ fetchImpl: fetchImpl as typeof fetch });

    await expect(client.listConnections()).rejects.toMatchObject({ code: 'authentication_required', status: 401 });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('syncs with credentials and returns mapped transactions', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('include');
      return new Response(
        JSON.stringify({ transactions: [{ date: '2026-10-04', vdate: '2026-10-04', ref: '', desc: 'Groceries', out: 42, in: 0, bal: null, pending: false, source: 'bank', src: 'open-banking', id: 'txn-1' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const client = new OpenBankingClient({ fetchImpl: fetchImpl as typeof fetch });

    const rows = await client.sync('conn-1');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'txn-1', src: 'open-banking' });
  });

  it('maps a non-OK sync response to a stable error', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 'open_banking_refresh_failed' }), { status: 502 }));
    const client = new OpenBankingClient({ fetchImpl: fetchImpl as typeof fetch });

    await expect(client.sync('conn-1')).rejects.toMatchObject(
      new OpenBankingError('open_banking_refresh_failed', 'Open Banking sync failed.', 502),
    );
  });

  it('disconnects with DELETE, credentials included, and no body', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init).toMatchObject({ method: 'DELETE', credentials: 'include', body: undefined });
      return new Response(null, { status: 204 });
    });
    const client = new OpenBankingClient({ fetchImpl: fetchImpl as typeof fetch });

    await expect(client.disconnect('conn-1')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/open-banking.unit.test.ts`
Expected: FAIL — `OpenBankingClient`'s constructor still requires `accessToken`, and `request` still builds an `Authorization` header with `credentials: 'omit'`.

- [ ] **Step 3: Rewrite `fe/src/open-banking.ts`**

Replace the full file contents with:

```ts
import { HttpStatus } from './http-status.js';
import type { BankTransaction } from './domain-model.js';

export interface OpenBankingSourceInfo {
  id: string;
  name: string;
  kind: 'bank' | 'card_issuer';
  mode: 'sandbox' | 'production' | 'unavailable';
}

export interface OpenBankingConnectionInfo {
  id: string;
  sourceId: string;
  status: 'active' | 'revoked';
  createdAt: string;
}

export class OpenBankingError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 0) {
    super(message);
    this.name = 'OpenBankingError';
  }
}

export class OpenBankingClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly input: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
    this.fetchImpl = input.fetchImpl || fetch;
  }

  connectHref(sourceId: string): string {
    return `/api/open-banking/connect/${encodeURIComponent(sourceId)}`;
  }

  private async request(method: 'GET' | 'POST' | 'DELETE', path: string): Promise<Record<string, unknown> | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.input.timeoutMs ?? 10_000);
    let response: Response;
    try {
      response = await this.fetchImpl(path, { method, credentials: 'include', signal: controller.signal, body: undefined });
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new OpenBankingError('open_banking_timeout', 'Open Banking request timed out.', HttpStatus.GATEWAY_TIMEOUT);
      }
      throw new OpenBankingError('open_banking_network_failed', 'Open Banking is currently unavailable.');
    } finally {
      clearTimeout(timeout);
    }
    const body = response.status === HttpStatus.NO_CONTENT ? null : await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const code = typeof body?.code === 'string' ? body.code : 'open_banking_request_failed';
      throw new OpenBankingError(code, 'Open Banking sync failed.', response.status);
    }
    return body;
  }

  async listSources(): Promise<OpenBankingSourceInfo[]> {
    const body = await this.request('GET', '/api/open-banking/sources');
    return (body?.sources as OpenBankingSourceInfo[] | undefined) ?? [];
  }

  async listConnections(): Promise<OpenBankingConnectionInfo[]> {
    const body = await this.request('GET', '/api/open-banking/connections');
    return (body?.connections as OpenBankingConnectionInfo[] | undefined) ?? [];
  }

  async sync(connectionId: string): Promise<BankTransaction[]> {
    const body = await this.request('POST', `/api/open-banking/sync/${encodeURIComponent(connectionId)}`);
    return (body?.transactions as BankTransaction[] | undefined) ?? [];
  }

  async disconnect(connectionId: string): Promise<void> {
    await this.request('DELETE', `/api/open-banking/connections/${encodeURIComponent(connectionId)}`);
  }
}
```

Note: `listSources` no longer needs its own `{ authenticated: false }` special case — there is no more explicit auth step in `request` at all; the server itself decides whether a route needs a signed-in cookie, and the browser either has one or doesn't. This is a deliberate simplification the removal of the `accessToken` abstraction makes possible.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/open-banking.unit.test.ts`
Expected: PASS (all 6)

- [ ] **Step 5: Run the broader unit suite**

Run: `npx vitest run tests/unit --environment jsdom`
Expected: PASS (this will also catch any other file still constructing `OpenBankingClient` with an `accessToken` option — none should exist yet, since `app.ts` isn't updated until Task 5, but confirm)

- [ ] **Step 6: Commit**

```bash
git add fe/src/open-banking.ts tests/unit/open-banking.unit.test.ts
git commit -m "feat(open-banking): drop token-in-JS plumbing, rely on the ambient session cookie"
```

---

### Task 5: Frontend sign-in/out UI and connect-button gating

**Files:**
- Modify: `fe/src/app.ts`
- Modify: `fe/mazan-habait.html`
- Modify: `fe/resources/he.json`, `fe/resources/en.json`, `fe/resources/am.json`, `fe/resources/fr.json`
- Test: `tests/component/sign-in.component.test.ts` (new)

**Interfaces:**
- Consumes: `OpenBankingClient` (Task 4, now constructor-argument-free), `GET /api/auth/session` (Task 2)
- Produces: a rendered sign-in/sign-out toggle; `#btn-open-banking` now also depends on sign-in state; an `?openBankingError=`/`?signInError=` query param is toasted and stripped on load

- [ ] **Step 1: Write the failing component test**

Create `tests/component/sign-in.component.test.ts`, following the exact pattern `tests/component/open-banking-panel.component.test.ts` already uses (load the static HTML through JSDOM, assert on markup — this test does not mount `app.ts` or stub `fetch`, same limitation already documented for the open-banking panel test):

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

describe('sign-in toggle', () => {
  it('starts with both the sign-in and sign-out controls hidden', () => {
    const html = readFileSync(resolve(__dirname, '../../fe/mazan-habait.html'), 'utf8');
    const document = new JSDOM(html).window.document;

    const signIn = document.querySelector<HTMLAnchorElement>('[data-testid="sign-in-trigger"]')!;
    const signOut = document.querySelector<HTMLButtonElement>('[data-testid="sign-out-trigger"]')!;

    expect(signIn).not.toBeNull();
    expect(signIn.hidden).toBe(true);
    expect(signIn.getAttribute('href')).toBe('/api/auth/google');
    expect(signOut).not.toBeNull();
    expect(signOut.hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/component/sign-in.component.test.ts`
Expected: FAIL — `signIn` is `null`

- [ ] **Step 3: Add the sign-in/sign-out markup to `fe/mazan-habait.html`**

Immediately before the existing `<button class="btn" id="btn-open-banking" ...>` line (the exact line this plan's earlier Open Banking work added), add:

```html
<a class="btn" id="btn-sign-in" href="/api/auth/google" hidden data-testid="sign-in-trigger">
  <span data-i18n="signIn">התחברות עם גוגל</span>
</a>
<button class="btn" id="btn-sign-out" type="button" hidden data-testid="sign-out-trigger">
  <span data-i18n="signOut">התנתקות</span>
</button>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/component/sign-in.component.test.ts`
Expected: PASS

- [ ] **Step 5: Add the resource strings**

In `fe/resources/he.json`, add beside `openBankingConnect`:
```json
"signIn": "התחברות עם גוגל",
"signOut": "התנתקות"
```
In `fe/resources/en.json`:
```json
"signIn": "Sign in with Google",
"signOut": "Sign out"
```
Add the same two keys, translated, to `fe/resources/am.json` and `fe/resources/fr.json` — flag these two for a native-speaker review before release, same convention the Open Banking plan already used; use the English strings as literal placeholders if no reliable translation is available.

- [ ] **Step 6: Wire the sign-in state in `fe/src/app.ts`**

Delete the `currentAccessToken` function and its doc comment entirely (the block starting `/* No sign-in flow is wired into the browser app yet ...`), and change:

```ts
const openBankingClient = new OpenBankingClient({ accessToken: () => currentAccessToken() });
```

to:

```ts
const openBankingClient = new OpenBankingClient();
```

Add, near that same block:

```ts
let signedIn = false;

async function loadSignInState() {
  const response = await fetch('/api/auth/session', { credentials: 'include' }).catch(() => null);
  const body = response ? await response.json().catch(() => null) as { signedIn?: boolean } | null : null;
  signedIn = body?.signedIn === true;
  $('#btn-sign-in').hidden = signedIn;
  $('#btn-sign-out').hidden = !signedIn;
}
```

- [ ] **Step 7: Gate `#btn-open-banking` on sign-in state too**

In `renderOpenBankingPanel`, change:

```ts
  $('#btn-open-banking').hidden = !openBankingSources.length;
```

to:

```ts
  $('#btn-open-banking').hidden = !openBankingSources.length || !signedIn;
```

- [ ] **Step 8: Call `loadSignInState` before `loadOpenBankingPanel` in the startup sequence**

Change:

```ts
loadResources().then(() => { render(); void loadOpenBankingPanel(); });
```

to:

```ts
loadResources().then(() => { render(); void loadSignInState().then(() => loadOpenBankingPanel()); });
```

(Sign-in state must be known before `renderOpenBankingPanel` runs inside `loadOpenBankingPanel`, since Step 7's gate reads `signedIn`.)

- [ ] **Step 9: Wire the sign-out button's click handler**

Add beside the existing `$('#btn-open-banking').addEventListener('click', ...)` wiring:

```ts
  $('#btn-sign-out').addEventListener('click', () => {
    void fetch('/api/auth/signout', { method: 'POST', credentials: 'include' }).then(() => {
      signedIn = false;
      $('#btn-sign-in').hidden = false;
      $('#btn-sign-out').hidden = true;
      void renderOpenBankingPanel();
    });
  });
```

- [ ] **Step 10: Handle the `?openBankingError=`/`?signInError=` query param on load**

Add a function, called once during startup (beside the other startup calls, e.g. right after `wire()`):

```ts
function reportAuthErrorFromQueryString() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('openBankingError') ?? params.get('signInError');
  if (!code) return;
  toast(code);
  params.delete('openBankingError');
  params.delete('signInError');
  const query = params.toString();
  history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
}
```

Call `reportAuthErrorFromQueryString();` once, synchronously, near the other startup wiring (it doesn't depend on `loadResources`/`loadSignInState` — the toast shows the raw error code, which is acceptable for now; a friendlier mapping to a translated message is a nice-to-have left for later, not required by this plan's Review Focus).

- [ ] **Step 11: Run the full unit and component suites**

Run: `npm run test:unit && npm run test:component`
Expected: PASS

- [ ] **Step 12: Run the full test gate**

Run: `npm run test:gate`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add fe/src/app.ts fe/mazan-habait.html fe/resources/he.json fe/resources/en.json fe/resources/am.json fe/resources/fr.json tests/component/sign-in.component.test.ts
git commit -m "feat(auth): sign-in/out UI, gate connect-a-bank on sign-in state, toast auth errors from redirects"
```

---

## Final Verification

- [ ] Run `pytest tests/server -v` — full server suite passes.
- [ ] Run `npm run test:unit && npm run test:component` — full frontend suites pass.
- [ ] Run `npm run test:gate` — the project's complete pre-merge gate passes.
- [ ] Confirm by direct code read that neither `server/app.py` nor `server/open_banking_routes.py` defines its own `_authenticated_client` anymore — both import `authenticated_client` from `server/http_auth.py`.
- [ ] Confirm `he_session` is still set with `httpOnly=True, secure=True, samesite="lax"` in `server/app.py` — unchanged.
- [ ] Confirm no file under `fe/src/` reads `document.cookie` anywhere (`git grep -n "document.cookie" fe/src/` should return nothing).
- [ ] Manual verification (not automatable here, same category as the Open Banking plan's deferred bank-sandbox check): a real Google sign-in round trip against this app's actual Supabase project — confirm the session cookie gets set, `/api/auth/session` reports `signedIn: true` afterward, and a subsequent `/api/open-banking/connect/{sourceId}` navigation plus the bank's redirect back to `/api/open-banking/callback` both succeed using only the cookie, no bearer header involved anywhere in the browser.
