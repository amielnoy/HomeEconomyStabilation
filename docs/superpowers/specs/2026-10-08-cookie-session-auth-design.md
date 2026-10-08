# Cookie-Based Session Auth Design

**Goal:** Let a real signed-in browser session actually authenticate against the API — fixing a pre-existing gap that blocks both cloud-sync and the Open Banking pilot (merged in `docs/superpowers/plans/2026-10-07-open-banking-integration.md`) from ever being exercised end to end by a real user.

**Context — why this is needed:** The Open Banking plan's Global Constraint assumed "connect and sync require ... an authenticated session (existing Google sign-in)," and its final whole-branch review approved a task ruling that `connect`/`callback` should gate on `_authenticated_client` (a `Authorization: Bearer` header check). A later review pass found this can never work: `connect` is reached by a plain link/navigation and `callback` is reached by the bank's own top-level redirect — neither can carry a custom header. Investigating further surfaced that this is not open-banking-specific: the existing Google sign-in flow (`/api/auth/google` → `/api/auth/callback` in `server/app.py`) already sets an `httpOnly` session cookie (`he_session`) holding the Supabase access token, but **no route anywhere reads it** — `_authenticated_client` only reads the header, which the browser has no legitimate way to populate (the token is httpOnly by design, so JavaScript cannot read it). `@supabase/supabase-js` is an installed but entirely unused dependency, suggesting an earlier, abandoned attempt at a different approach. Cloud-sync (`/api/snapshots`, `/api/profile`, `/api/consents/cloud-sync`) has the identical problem — this is why `fe/src/consent.ts` notes cloud-sync as "not yet wired."

**Approach:** Make the existing `he_session` cookie the one real auth mechanism, read by a shared server-side helper, with the frontend relying on the browser's automatic cookie handling (`credentials: 'include'`) instead of managing a bearer token in JS at all. Two alternatives were considered and rejected: adopting `@supabase/supabase-js` for client-held tokens still cannot solve `callback`'s redirect-carries-no-headers constraint, so it would need the cookie anyway on top of its own complexity; and exposing a second, JS-readable token cookie was rejected because it deliberately undoes the `httpOnly` protection the existing code's own comment explains was intentional.

**Tech Stack:** No new dependencies. Python/FastAPI server-side; vanilla `fetch` with `credentials: 'include'` on the frontend (no `@supabase/supabase-js` usage — it remains an unused dependency, out of scope to either wire up or remove here).

## Global Constraints

- The `he_session` cookie's `httpOnly`/`secure`/`samesite=lax` properties do not change. No token material becomes JS-readable anywhere as part of this work.
- `Authorization: Bearer` support is kept alongside the cookie (header wins if both are present) — this does not become cookie-only, to avoid breaking any future non-browser API client and to keep the existing test patterns that monkeypatch header-based auth largely intact.
- `connect`'s and `callback`'s own request-handling logic (sandbox/licence gate, consent check, PKCE cookie handling, `OpenBankingRepository` calls) is **not redesigned** — only the auth *source* changes, from header-only to header-or-cookie. The routes' shape, built and reviewed in the Open Banking plan, stays as-is.
- Scope is the general auth-wiring gap plus the specific UI/UX pieces that depend on it (sign-in affordance, connect-button gating, callback error redirects). It explicitly does NOT include: the open-banking consent-granting UI (a separate, not-yet-built feature), the two parked Open Banking precision fixes (narrowing revoke-on-refusal to `invalid_grant` specifically; serializing concurrent syncs), or the NextGenPSD2 protocol/real-sandbox work (blocked on real Bank Hapoalim credentials). These remain separate follow-ups.
- No automated test can exercise a real Google OAuth round trip in this environment (no real Google test credentials) — same category of limitation as the Open Banking plan's unverified real-bank-sandbox gap. Automated coverage proves the signed-out and cookie-mechanics paths; an actual sign-in round trip remains a manual verification step.

## File Structure

### Server

- **New:** `server/http_auth.py` — the shared `authenticated_client(request) -> tuple[SupabaseRestClient, str] | JSONResponse` helper, reading `Authorization: Bearer` first, falling back to the `he_session` cookie. Replaces the two existing copies (`server/app.py`'s `_authenticated_client`, `server/open_banking_routes.py`'s `_authenticated_client`), which both import and use this instead. `open_banking_routes.py` drops its lazy `from . import app as app_module` workaround — it no longer needs to reach through `server.app` at all, resolving the reverse-dependency Minor finding noted in the Open Banking plan's ledger.
- **Modify:** `server/app.py` — import and use the shared helper; add `GET /api/auth/session` returning `{"signedIn": bool}` (200 always, calls the shared helper internally and reports whether it succeeded, without ever returning the helper's own error response); modify `finish_google_sign_in`'s and the open-banking `callback`'s failure paths to redirect to the landing page with an error query param instead of returning raw JSON (see Error Handling below).
- **Modify:** `server/open_banking_routes.py` — import the shared helper instead of its own copy; `callback`'s failure branches redirect instead of returning JSON; PKCE cookies are cleared on every exit path, not only success.

### Frontend

- **Modify:** `fe/src/open-banking.ts` — `OpenBankingClient`'s constructor drops the `accessToken` parameter; every authenticated request adds `credentials: 'include'` instead of building an `Authorization` header. `connectHref()` is unchanged (still a plain path string).
- **Modify:** `fe/src/app.ts` — delete `currentAccessToken()` and its wiring; add a small sign-in/sign-out UI block (a "Sign in" link to `/api/auth/google` when signed out; a "Signed in" indicator + sign-out button posting to `/api/auth/signout` when signed in), driven by one `GET /api/auth/session` call at startup (`credentials: 'include'`); the "Connect a bank" button's visibility now depends on both sign-in state and `openBankingSources.length > 0` — hidden (or replaced with the sign-in prompt) when signed out.
- **Modify:** `fe/mazan-habait.html` — add the sign-in/sign-out markup (hidden-by-default, like the existing open-banking button/panel pattern), plus handling for the new `?openBankingError=<code>` query param on page load (toast the error, matching how other errors already surface, then strip the param from the URL).

## Review Focus

- A signed-out caller hitting any route that now accepts the cookie must still get the exact same 401/403 behavior as today when neither the header nor the cookie is present — prove this doesn't accidentally relax any existing test's auth guarantee.
- `callback`'s failure paths (state mismatch, exchange failure, connection-write failure, consent-check failure) must redirect to the landing page with an error code, never return a raw JSON body to a real browser navigation, and must clear all three PKCE cookies on every exit, not just success.
- No response anywhere exposes the `he_session` cookie's value or any token material — this is a continuation of the Open Banking plan's existing "no token material in responses" guarantee, now also covering the new `/api/auth/session` endpoint (it reports a boolean, nothing else).
- `Authorization: Bearer` support must remain fully functional and take precedence when both are present — existing tests that monkeypatch header-based auth must keep passing unmodified where reasonable, with cookie-path coverage added alongside rather than replacing them.

## Final Verification

- [ ] Run `pytest tests/server -v` — full server suite passes, including new `test_http_auth.py` coverage.
- [ ] Run `npm run test:unit && npm run test:component` — full frontend suite passes, including updated `open-banking.unit.test.ts` and new sign-in/sign-out component coverage.
- [ ] Run `npm run test:gate` — the project's complete pre-merge gate passes.
- [ ] Confirm by direct code read that neither `server/app.py` nor `server/open_banking_routes.py` defines its own `_authenticated_client` anymore — both import `server/http_auth.py`.
- [ ] Confirm `he_session` is still set with `httpOnly=True, secure=True, samesite="lax"` — unchanged.
- [ ] Manual verification (same category as the Open Banking plan's deferred bank-sandbox check, not automatable here): a real Google sign-in round trip against this app's actual Supabase project, confirming the session cookie is set, `/api/auth/session` reports `signedIn: true` afterward, and a subsequent `/api/open-banking/connect/{sourceId}` navigation and the bank's redirect back to `/api/open-banking/callback` both succeed using only the cookie — no bearer header involved at any point in the browser.
