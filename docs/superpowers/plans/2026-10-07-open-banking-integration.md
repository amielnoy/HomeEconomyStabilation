# Open Banking Integration (Bank Hapoalim pilot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a household connect a real bank/card account via the Bank of Israel's Open Banking standard and pull transactions on demand, proven end to end against Bank Hapoalim's sandbox, with every non-sandbox call refused until `OPEN_BANKING_LICENCE_ID` is set.

**Architecture:** Extend the existing FastAPI server (`server/`) with a new `open_banking_*` module family and two new Supabase tables, following the exact PKCE/consent/repository patterns `auth_flow.py`/`supabase_store.py`/`app.py` already use. Pulled transactions are mapped into the existing `Transaction`/`BankTransaction` shape with a new `src: 'open-banking'` provenance value, so every existing piece of transaction logic (categorizer, settlement neutralising, card-summary folding) handles them unchanged. Read-only (AIS), on-demand sync only, no payment initiation, no background scheduler.

**Tech Stack:** Python 3.12 / FastAPI / Pydantic / httpx / `cryptography` (new dependency) on the server; TypeScript / Vitest on the frontend; Supabase Postgres with RLS.

**Spec:** [docs/superpowers/specs/2026-10-07-open-banking-integration-design.md](../specs/2026-10-07-open-banking-integration-design.md)

## Global Constraints

- Read-only (AIS) only. No payment initiation (PIS) anywhere in this plan.
- On-demand sync only. No background scheduler, no unattended token refresh.
- Every call against a non-sandbox source is refused unless `OPEN_BANKING_LICENCE_ID` is set. `OPEN_BANKING_SANDBOX=1` is required for any sandbox call to run at all.
- Pilot source is Bank Hapoalim's sandbox only; no other institution is wired up in this plan.
- The refresh token is encrypted with `cryptography.fernet.Fernet` (key from `OPEN_BANKING_TOKEN_ENCRYPTION_KEY`) **before** it reaches Supabase, decrypted only in memory for the duration of a call, and never logged.
- A new `SnapshotSource`/`src` value, `'open-banking'`, must be added in lockstep in all four places a `src` value is known: `fe/src/privacy.ts` (browser allowlist), `fe/src/state-repository.ts` (state codec — verify it needs no change, since it validates `src` generically), `server/models.py` (Pydantic model), and `fe/openapi.json` (OpenAPI schema).
- `connect` and `sync` require both an authenticated session (existing Google sign-in) and an active `open_banking` consent, exactly as `/api/snapshots` requires active `cloud_sync` consent today.
- No account number, IBAN, card number or similar identifier is ever persisted — route every mapped description through the existing `_contains_financial_identifier` (Python) / `redactFinancialIdentifiers` (TypeScript) boundary.

## Review Focus

- A synced transaction description carrying an account-like number (e.g. an XS2A `remittanceInformationUnstructured` field echoing a reference) must come out redacted, not stored raw — Task 7's mapper must call the existing identifier-redaction path, and Task 7's tests must prove it.
- Clicking "Sync now" twice, or syncing after the same period was already covered by a manual statement import, must not create duplicate rows — dedupe by transaction `id`, proven in Task 11.
- A connection whose consent the bank reports expired or withdrawn mid-sync must leave the app in a safe state: `status` moves to `revoked`, the stored token is deleted immediately, and the UI reports the failure rather than silently showing stale data or crashing — proven in Task 8.
- `OPEN_BANKING_SANDBOX` unset (or `0`) with a source configured must refuse to run, not silently fall through and call a sandbox-shaped URL against what might be a production host — proven in Task 1 and exercised again in Task 8's route tests.
- No response the browser can read — `/api/open-banking/connections`, `/sync`, or any error body — may ever contain `encrypted_refresh_token` or any other token material. This is a shape assertion, not just "it isn't used": prove the field is absent from the serialised JSON, not merely unread, in Task 8.

---

## File Structure

**New files:**
- `server/open_banking_config.py` — source list / sandbox / licence parsing
- `server/open_banking_crypto.py` — Fernet encrypt/decrypt of the refresh token
- `server/open_banking_flow.py` — authorize URL + token exchange/refresh for a source
- `server/open_banking_store.py` — Supabase repository for connections + encrypted tokens
- `server/open_banking_sync.py` — XS2A pull + mapping into `Transaction`
- `server/open_banking_routes.py` — the `APIRouter` with all open-banking endpoints
- `supabase/migrations/202610070001_open_banking_connections.sql`
- `fe/src/open-banking.ts` — browser client mirroring `cloud-sync.ts`
- `fe/src/open-banking-sync.ts` — merge-by-id of synced transactions into `S.tx`
- `tests/server/test_open_banking_config.py`
- `tests/server/test_open_banking_crypto.py`
- `tests/server/test_open_banking_store.py`
- `tests/server/test_open_banking_flow.py`
- `tests/server/test_open_banking_sync.py`
- `tests/server/test_open_banking_routes.py`
- `tests/unit/open-banking.unit.test.ts`
- `tests/unit/open-banking-sync.unit.test.ts`

**Modified files:**
- `server/models.py` — widen `SnapshotSource`, widen `ConsentAcceptance.purpose`
- `server/supabase_store.py` — generalise `ConsentRepository` to take a `purpose`
- `server/app.py` — mount the new router
- `requirements.txt`, `requirements-dev.txt`, `pyproject.toml` — add `cryptography`
- `.env.example` — add `OPEN_BANKING_TOKEN_ENCRYPTION_KEY`
- `fe/src/privacy.ts` — recognise and preserve `src: 'open-banking'`
- `fe/src/app.ts` — "Connect a bank" entry point, connections list, sync/disconnect wiring
- `fe/mazan-habait.html` — the new button and a connections panel
- `fe/resources/{he,en,am,fr}.json` — new UI strings
- `fe/openapi.json` (and its build copy `public/openapi.json`, regenerated, not hand-edited)
- `tests/contract/openapi.contract.test.ts` — assertions for the new paths
- `tests/unit/privacy.unit.test.ts`, `tests/server/test_models.py`, `tests/server/test_repositories.py` — extended

---

### Task 1: Source configuration, sandbox/licence gate, and token encryption

**Files:**
- Create: `server/open_banking_config.py`
- Create: `server/open_banking_crypto.py`
- Test: `tests/server/test_open_banking_config.py`
- Test: `tests/server/test_open_banking_crypto.py`
- Modify: `.env.example`
- Modify: `requirements.txt`, `requirements-dev.txt`, `pyproject.toml`

**Interfaces:**
- Produces: `OpenBankingSource` (dataclass: `id: str, kind: Literal["bank","card_issuer"], name: str, base_url: str, authorization_url: str, token_url: str`), `read_sources(env: dict[str, str] | None = None) -> list[OpenBankingSource]`, `sandbox_enabled(env=None) -> bool`, `licence_id(env=None) -> str | None`, `client_id_for(source_id: str, env=None) -> str | None`
- Produces: `encrypt_token(plaintext: str, env=None) -> str | None` (returns `None` if no key configured), `decrypt_token(ciphertext: str, env=None) -> str | None`

- [ ] **Step 1: Write the failing tests for source parsing**

```python
# tests/server/test_open_banking_config.py
from server.open_banking_config import OpenBankingSource, client_id_for, licence_id, read_sources, sandbox_enabled

HAPOALIM_LINE = (
    "hapoalim|bank|בנק הפועלים|https://api.poalimdev.co.il/psd2/sandbox"
    "|https://api.poalimdev.co.il/oauth/authorize|https://api.poalimdev.co.il/oauth/token"
)


def test_a_well_formed_source_line_parses_into_a_source() -> None:
    sources = read_sources({"OPEN_BANKING_SOURCES": HAPOALIM_LINE})
    assert sources == [
        OpenBankingSource(
            id="hapoalim", kind="bank", name="בנק הפועלים",
            base_url="https://api.poalimdev.co.il/psd2/sandbox",
            authorization_url="https://api.poalimdev.co.il/oauth/authorize",
            token_url="https://api.poalimdev.co.il/oauth/token",
        )
    ]


def test_an_http_line_is_dropped_rather_than_trusted() -> None:
    line = HAPOALIM_LINE.replace("https://api.poalimdev.co.il/psd2/sandbox", "http://api.poalimdev.co.il/psd2/sandbox")
    assert read_sources({"OPEN_BANKING_SOURCES": line}) == []


def test_a_malformed_line_is_dropped_not_guessed_at() -> None:
    assert read_sources({"OPEN_BANKING_SOURCES": "too|few|fields"}) == []
    assert read_sources({"OPEN_BANKING_SOURCES": HAPOALIM_LINE.replace("bank", "savings", 1)}) == []


def test_multiple_sources_are_newline_separated() -> None:
    other = HAPOALIM_LINE.replace("hapoalim", "other")
    sources = read_sources({"OPEN_BANKING_SOURCES": f"{HAPOALIM_LINE}\n{other}"})
    assert [s.id for s in sources] == ["hapoalim", "other"]


def test_sandbox_and_licence_flags_read_from_the_environment() -> None:
    assert sandbox_enabled({}) is False
    assert sandbox_enabled({"OPEN_BANKING_SANDBOX": "1"}) is True
    assert licence_id({}) is None
    assert licence_id({"OPEN_BANKING_LICENCE_ID": "isa-12345"}) == "isa-12345"


def test_client_id_is_read_by_upper_cased_source_suffix() -> None:
    env = {"OPEN_BANKING_CLIENT_ID_HAPOALIM": "client-abc"}
    assert client_id_for("hapoalim", env) == "client-abc"
    assert client_id_for("missing", env) is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/server/test_open_banking_config.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'server.open_banking_config'`

- [ ] **Step 3: Implement `server/open_banking_config.py`**

```python
from __future__ import annotations

from dataclasses import dataclass
from os import environ
from typing import Literal
from urllib.parse import urlparse

SourceKind = Literal["bank", "card_issuer"]


@dataclass(frozen=True, slots=True)
class OpenBankingSource:
    id: str
    kind: SourceKind
    name: str
    base_url: str
    authorization_url: str
    token_url: str


def _https(value: str) -> str | None:
    parsed = urlparse(value)
    return value if parsed.scheme == "https" and parsed.netloc else None


def _parse_line(line: str) -> OpenBankingSource | None:
    parts = line.split("|")
    if len(parts) != 6:
        return None
    source_id, kind, name, base_url, authorization_url, token_url = (part.strip() for part in parts)
    if kind not in ("bank", "card_issuer") or not source_id or not name:
        return None
    urls = (_https(base_url), _https(authorization_url), _https(token_url))
    if not all(urls):
        return None
    return OpenBankingSource(
        id=source_id, kind=kind, name=name,
        base_url=urls[0], authorization_url=urls[1], token_url=urls[2],  # type: ignore[arg-type]
    )


def read_sources(env: dict[str, str] | None = None) -> list[OpenBankingSource]:
    values = env if env is not None else environ
    raw = values.get("OPEN_BANKING_SOURCES", "")
    sources = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        parsed = _parse_line(line)
        if parsed:
            sources.append(parsed)
    return sources


def sandbox_enabled(env: dict[str, str] | None = None) -> bool:
    values = env if env is not None else environ
    return values.get("OPEN_BANKING_SANDBOX") == "1"


def licence_id(env: dict[str, str] | None = None) -> str | None:
    values = env if env is not None else environ
    return values.get("OPEN_BANKING_LICENCE_ID") or None


def client_id_for(source_id: str, env: dict[str, str] | None = None) -> str | None:
    values = env if env is not None else environ
    return values.get(f"OPEN_BANKING_CLIENT_ID_{source_id.upper()}") or None
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/server/test_open_banking_config.py -v`
Expected: PASS

- [ ] **Step 5: Write the failing tests for token encryption**

```python
# tests/server/test_open_banking_crypto.py
from cryptography.fernet import Fernet

from server.open_banking_crypto import decrypt_token, encrypt_token


def test_round_trips_a_token_through_encryption() -> None:
    key = Fernet.generate_key().decode()
    env = {"OPEN_BANKING_TOKEN_ENCRYPTION_KEY": key}

    ciphertext = encrypt_token("refresh-token-value", env)

    assert ciphertext is not None
    assert "refresh-token-value" not in ciphertext
    assert decrypt_token(ciphertext, env) == "refresh-token-value"


def test_encryption_without_a_configured_key_fails_closed() -> None:
    assert encrypt_token("refresh-token-value", {}) is None


def test_decryption_with_the_wrong_key_fails_closed_rather_than_raising() -> None:
    first_key = Fernet.generate_key().decode()
    second_key = Fernet.generate_key().decode()
    ciphertext = encrypt_token("refresh-token-value", {"OPEN_BANKING_TOKEN_ENCRYPTION_KEY": first_key})

    assert decrypt_token(ciphertext, {"OPEN_BANKING_TOKEN_ENCRYPTION_KEY": second_key}) is None  # type: ignore[arg-type]
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `pytest tests/server/test_open_banking_crypto.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'server.open_banking_crypto'`

- [ ] **Step 7: Add the `cryptography` dependency**

In `requirements.txt`, add a line after `httpx==0.28.1`:
```
cryptography==44.0.0
```
In `pyproject.toml`, add `"cryptography==44.0.0"` to the `dependencies` list.
Run: `pip install -r requirements-dev.txt`

- [ ] **Step 8: Implement `server/open_banking_crypto.py`**

```python
from __future__ import annotations

from os import environ

from cryptography.fernet import Fernet, InvalidToken


def _key(env: dict[str, str] | None) -> bytes | None:
    values = env if env is not None else environ
    raw = values.get("OPEN_BANKING_TOKEN_ENCRYPTION_KEY")
    return raw.encode() if raw else None


def encrypt_token(plaintext: str, env: dict[str, str] | None = None) -> str | None:
    """None when no key is configured — a caller that ignores this return value stores
    nothing, which is the point: there is no code path that writes a refresh token to
    Supabase unencrypted."""
    key = _key(env)
    if not key:
        return None
    return Fernet(key).encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str, env: dict[str, str] | None = None) -> str | None:
    key = _key(env)
    if not key:
        return None
    try:
        return Fernet(key).decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        return None
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pytest tests/server/test_open_banking_crypto.py -v`
Expected: PASS

- [ ] **Step 10: Add the new env var documentation**

In `.env.example`, after the `OPEN_BANKING_CLIENT_KEY` lines, add:
```
# The key the refresh token is encrypted with before it reaches Supabase, and
# decrypted with only in memory for the length of a sync call. Required once any
# source above is configured; absent, the feature reports unconfigured rather than
# storing a token unencrypted. Generate with: python -c "from cryptography.fernet
# import Fernet; print(Fernet.generate_key().decode())"
# OPEN_BANKING_TOKEN_ENCRYPTION_KEY=
```

- [ ] **Step 11: Commit**

```bash
git add server/open_banking_config.py server/open_banking_crypto.py tests/server/test_open_banking_config.py tests/server/test_open_banking_crypto.py requirements.txt requirements-dev.txt pyproject.toml .env.example
git commit -m "feat(open-banking): parse sources and encrypt tokens before storage"
```

---

### Task 2: Widen the Pydantic models for the new consent purpose and `src` value

**Files:**
- Modify: `server/models.py`
- Modify: `tests/server/test_models.py`

**Interfaces:**
- Consumes: nothing new
- Produces: `SnapshotSource = Literal["bank-report", "card-report", "manual-entry", "open-banking"]`; `ConsentAcceptance.purpose: Literal["cloud_sync", "open_banking"]`

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/test_models.py` (find the existing `Transaction`/`ConsentAcceptance` tests and add beside them):

```python
def test_a_transaction_accepts_the_open_banking_provenance() -> None:
    transaction = Transaction.model_validate({
        "date": "2026-10-04", "vdate": "2026-10-04", "ref": "", "desc": "Groceries",
        "out": 42.0, "in": 0.0, "bal": None, "pending": False, "source": "bank",
        "src": "open-banking",
    })
    assert transaction.src == "open-banking"


def test_an_open_banking_consent_acceptance_validates() -> None:
    acceptance = ConsentAcceptance.model_validate({
        "user_id": "user-1", "purpose": "open_banking", "statement_version": "v1",
        "locale": "he", "accepted_at": "2026-10-07T00:00:00Z", "withdrawn_at": None,
    })
    assert acceptance.purpose == "open_banking"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/server/test_models.py -v -k open_banking`
Expected: FAIL — `src`/`purpose` rejected as not matching the `Literal`

- [ ] **Step 3: Widen the two literals**

In `server/models.py`, change line 11:
```python
SnapshotSource = Literal["bank-report", "card-report", "manual-entry", "open-banking"]
```
And in the `ConsentAcceptance` class, change:
```python
    purpose: Literal["cloud_sync"]
```
to:
```python
    purpose: Literal["cloud_sync", "open_banking"]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/server/test_models.py -v`
Expected: PASS, including every previously-passing test in the file

- [ ] **Step 5: Commit**

```bash
git add server/models.py tests/server/test_models.py
git commit -m "feat(open-banking): widen snapshot source and consent purpose literals"
```

---

### Task 3: Generalise `ConsentRepository` to a configurable purpose

**Files:**
- Modify: `server/supabase_store.py`
- Modify: `tests/server/test_repositories.py`

**Interfaces:**
- Consumes: `ConsentAcceptance.purpose: Literal["cloud_sync", "open_banking"]` (Task 2)
- Produces: `ConsentRepository(client, user_id, purpose: Literal["cloud_sync", "open_banking"] = "cloud_sync")` — same `read`/`accept`/`withdraw` signatures as before, now scoped to the purpose given at construction

- [ ] **Step 1: Write the failing test**

Add to `tests/server/test_repositories.py`, beside the existing consent test:

```python
def test_consent_repository_scopes_every_call_to_its_own_purpose() -> None:
    consent = {
        "user_id": "user-1", "purpose": "open_banking", "statement_version": "v1", "locale": "he",
        "accepted_at": "2026-10-07T00:00:00Z", "withdrawn_at": None,
    }
    client = FakeRestClient([[consent], [consent]])
    repository = ConsentRepository(client, "user-1", purpose="open_banking")  # type: ignore[arg-type]

    assert repository.read("v1").purpose == "open_banking"  # type: ignore[union-attr]
    repository.accept("v1", "he")

    read_call, write_call = client.calls
    assert read_call["params"]["purpose"] == "eq.open_banking"
    assert write_call["json"]["purpose"] == "open_banking"


def test_consent_repository_still_defaults_to_cloud_sync() -> None:
    consent = {
        "user_id": "user-1", "purpose": "cloud_sync", "statement_version": "v2", "locale": "he",
        "accepted_at": "2026-08-24T20:00:00Z", "withdrawn_at": None,
    }
    client = FakeRestClient([[consent]])
    repository = ConsentRepository(client, "user-1")  # type: ignore[arg-type]

    assert repository.read("v2").purpose == "cloud_sync"  # type: ignore[union-attr]
    assert client.calls[0]["params"]["purpose"] == "eq.cloud_sync"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/server/test_repositories.py -v -k purpose`
Expected: FAIL with `TypeError: ConsentRepository.__init__() got an unexpected keyword argument 'purpose'`

- [ ] **Step 3: Generalise the repository**

In `server/supabase_store.py`, change the `ConsentRepository` class:

```python
class ConsentRepository:
    def __init__(
        self, client: SupabaseRestClient, user_id: str,
        purpose: Literal["cloud_sync", "open_banking"] = "cloud_sync",
    ) -> None:
        self._client, self._user_id, self._purpose = client, user_id, purpose

    def read(self, statement_version: str) -> ConsentAcceptance | None:
        rows = self._client.table_request(
            "GET", "consent_acceptances", operation="consent_read",
            params={
                "user_id": f"eq.{self._user_id}", "purpose": f"eq.{self._purpose}",
                "statement_version": f"eq.{statement_version}", "select": "*", "limit": "1",
            },
        )
        return ConsentAcceptance.model_validate(rows[0]) if rows else None

    def accept(self, statement_version: str, locale: Locale) -> ConsentAcceptance:
        accepted_at = datetime.now(timezone.utc).isoformat()
        rows = self._client.table_request(
            "POST", "consent_acceptances", operation="consent_write", params={"select": "*"},
            json={
                "user_id": self._user_id, "purpose": self._purpose,
                "statement_version": statement_version, "locale": locale,
                "accepted_at": accepted_at, "withdrawn_at": None,
            }, prefer="return=representation,resolution=merge-duplicates",
        )
        if not rows:
            raise SupabaseDataError("consent_write")
        return ConsentAcceptance.model_validate(rows[0])

    def withdraw(self, statement_version: str) -> ConsentAcceptance:
        rows = self._client.table_request(
            "PATCH", "consent_acceptances", operation="consent_withdraw",
            params={
                "user_id": f"eq.{self._user_id}", "purpose": f"eq.{self._purpose}",
                "statement_version": f"eq.{statement_version}", "select": "*",
            },
            json={"withdrawn_at": datetime.now(timezone.utc).isoformat()}, prefer="return=representation",
        )
        if not rows:
            raise SupabaseDataError("consent_withdraw")
        return ConsentAcceptance.model_validate(rows[0])
```

This only replaces the literal `"cloud_sync"` occurrences with `self._purpose`; every existing call site in `app.py` (`ConsentRepository(client, user_id)`) keeps working unchanged because the parameter defaults to `"cloud_sync"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/server/test_repositories.py -v`
Expected: PASS, including every previously-passing test in the file

- [ ] **Step 5: Run the full server suite to confirm nothing else broke**

Run: `pytest tests/server -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/supabase_store.py tests/server/test_repositories.py
git commit -m "refactor(open-banking): let ConsentRepository scope to any purpose"
```

---

### Task 4: Supabase migration for connections and encrypted tokens

**Files:**
- Create: `supabase/migrations/202610070001_open_banking_connections.sql`

**Interfaces:**
- Produces: tables `public.open_banking_connections`, `public.open_banking_tokens`; widens the `consent_acceptances.purpose` check constraint

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/202610070001_open_banking_connections.sql

alter table public.consent_acceptances drop constraint if exists consent_acceptances_purpose_check;
alter table public.consent_acceptances add constraint consent_acceptances_purpose_check
  check (purpose in ('cloud_sync', 'open_banking'));

create table if not exists public.open_banking_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id text not null check (length(source_id) between 1 and 100),
  status text not null default 'active' check (status in ('active', 'revoked')),
  consent_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.open_banking_tokens (
  connection_id uuid primary key references public.open_banking_connections(id) on delete cascade,
  encrypted_refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.open_banking_connections enable row level security;
alter table public.open_banking_tokens enable row level security;

revoke all on table public.open_banking_connections from anon, authenticated;
grant select on table public.open_banking_connections to authenticated;
grant insert (user_id, source_id, status, consent_expires_at) on table public.open_banking_connections to authenticated;
grant update (status, consent_expires_at) on table public.open_banking_connections to authenticated;
grant delete on table public.open_banking_connections to authenticated;

create policy "users read their own connections" on public.open_banking_connections for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "users create their own connections" on public.open_banking_connections for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "users update their own connections" on public.open_banking_connections for update to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "users delete their own connections" on public.open_banking_connections for delete to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

-- Tokens carry no user_id of their own: ownership is proven by joining back to the
-- connection row, so a token can never be read, written or deleted without also
-- passing the connections policy above.
revoke all on table public.open_banking_tokens from anon, authenticated;
grant select on table public.open_banking_tokens to authenticated;
grant insert (connection_id, encrypted_refresh_token) on table public.open_banking_tokens to authenticated;
grant update (encrypted_refresh_token) on table public.open_banking_tokens to authenticated;
grant delete on table public.open_banking_tokens to authenticated;

create policy "users read their own tokens" on public.open_banking_tokens for select to authenticated
using (exists (
  select 1 from public.open_banking_connections c
  where c.id = connection_id and c.user_id = (select auth.uid())
));
create policy "users write their own tokens" on public.open_banking_tokens for insert to authenticated
with check (exists (
  select 1 from public.open_banking_connections c
  where c.id = connection_id and c.user_id = (select auth.uid())
));
create policy "users update their own tokens" on public.open_banking_tokens for update to authenticated
using (exists (
  select 1 from public.open_banking_connections c
  where c.id = connection_id and c.user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.open_banking_connections c
  where c.id = connection_id and c.user_id = (select auth.uid())
));
create policy "users delete their own tokens" on public.open_banking_tokens for delete to authenticated
using (exists (
  select 1 from public.open_banking_connections c
  where c.id = connection_id and c.user_id = (select auth.uid())
));

drop trigger if exists open_banking_tokens_touch_updated_at on public.open_banking_tokens;
create trigger open_banking_tokens_touch_updated_at
before update on public.open_banking_tokens
for each row execute function public.touch_app_snapshot_updated_at();

comment on table public.open_banking_connections is 'A household''s connection to one Open Banking source. No account number or card number is stored here.';
comment on table public.open_banking_tokens is 'The encrypted refresh token for one connection. Encrypted by the server before it arrives; never readable as plaintext from Postgres.';
```

- [ ] **Step 2: Check it against the existing migration pattern by eye**

Diff the structure of this file against `supabase/migrations/202608230001_create_app_snapshots.sql` and `202608240002_server_repository_support.sql`: same `revoke all` / `grant` column-list / per-operation `create policy` shape, same reuse of `touch_app_snapshot_updated_at`. There is no local Supabase instance in this repo to apply the migration against in CI — this is a structural review, not a run.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202610070001_open_banking_connections.sql
git commit -m "feat(open-banking): add connections and encrypted-token tables"
```

---

### Task 5: Repository for connections and tokens

**Files:**
- Create: `server/open_banking_store.py`
- Test: `tests/server/test_open_banking_store.py`

**Interfaces:**
- Consumes: `SupabaseRestClient` (existing), `encrypt_token`/`decrypt_token` (Task 1)
- Produces:
  - `@dataclass OpenBankingConnection: id: str, source_id: str, status: Literal["active","revoked"], created_at: str`
  - `class OpenBankingRepository(client, user_id, env: dict[str,str] | None = None)` with:
    - `list_connections() -> list[OpenBankingConnection]`
    - `create_connection(source_id: str, refresh_token: str) -> OpenBankingConnection`
    - `read_refresh_token(connection_id: str) -> str | None` (decrypted)
    - `replace_refresh_token(connection_id: str, refresh_token: str) -> None`
    - `revoke(connection_id: str) -> None` (sets status to `revoked` and deletes the token row)

- [ ] **Step 1: Write the failing tests**

```python
# tests/server/test_open_banking_store.py
from collections import deque
from typing import Any

from cryptography.fernet import Fernet

from server.open_banking_store import OpenBankingRepository

ENV = {"OPEN_BANKING_TOKEN_ENCRYPTION_KEY": Fernet.generate_key().decode()}


class FakeRestClient:
    def __init__(self, responses: list[list[dict[str, Any]] | Exception]) -> None:
        self.responses = deque(responses)
        self.calls: list[dict[str, Any]] = []

    def table_request(self, method: str, table: str, **kwargs: Any) -> list[dict[str, Any]]:
        self.calls.append({"method": method, "table": table, **kwargs})
        response = self.responses.popleft()
        if isinstance(response, Exception):
            raise response
        return response


def test_creating_a_connection_stores_the_refresh_token_encrypted_not_plaintext() -> None:
    connection_row = {"id": "conn-1", "source_id": "hapoalim", "status": "active", "created_at": "2026-10-07T00:00:00Z"}
    client = FakeRestClient([[connection_row], [{"connection_id": "conn-1"}]])
    repository = OpenBankingRepository(client, "user-1", env=ENV)  # type: ignore[arg-type]

    connection = repository.create_connection("hapoalim", "sandbox-refresh-token")

    assert connection.id == "conn-1"
    connection_write, token_write = client.calls
    assert connection_write["json"] == {"user_id": "user-1", "source_id": "hapoalim", "status": "active"}
    assert token_write["table"] == "open_banking_tokens"
    assert token_write["json"]["connection_id"] == "conn-1"
    assert "sandbox-refresh-token" not in token_write["json"]["encrypted_refresh_token"]


def test_reading_a_refresh_token_decrypts_it() -> None:
    client = FakeRestClient([])
    repository = OpenBankingRepository(client, "user-1", env=ENV)  # type: ignore[arg-type]
    from server.open_banking_crypto import encrypt_token
    stored = encrypt_token("sandbox-refresh-token", ENV)
    client.responses.append([{"encrypted_refresh_token": stored}])

    assert repository.read_refresh_token("conn-1") == "sandbox-refresh-token"
    assert client.calls[0]["params"]["connection_id"] == "eq.conn-1"


def test_reading_a_missing_token_returns_none_rather_than_raising() -> None:
    client = FakeRestClient([[]])
    repository = OpenBankingRepository(client, "user-1", env=ENV)  # type: ignore[arg-type]
    assert repository.read_refresh_token("conn-1") is None


def test_revoking_deletes_the_token_and_marks_the_connection_revoked() -> None:
    client = FakeRestClient([[], [{"id": "conn-1", "source_id": "hapoalim", "status": "revoked", "created_at": "2026-10-07T00:00:00Z"}]])
    repository = OpenBankingRepository(client, "user-1", env=ENV)  # type: ignore[arg-type]

    repository.revoke("conn-1")

    token_delete, status_update = client.calls
    assert token_delete == {"method": "DELETE", "table": "open_banking_tokens", "operation": "open_banking_token_delete",
                             "params": {"connection_id": "eq.conn-1"}, "prefer": "return=minimal"}
    assert status_update["json"] == {"status": "revoked"}


def test_listing_connections_scopes_to_the_user() -> None:
    row = {"id": "conn-1", "source_id": "hapoalim", "status": "active", "created_at": "2026-10-07T00:00:00Z"}
    client = FakeRestClient([[row]])
    repository = OpenBankingRepository(client, "user-1", env=ENV)  # type: ignore[arg-type]

    connections = repository.list_connections()

    assert connections[0].source_id == "hapoalim"
    assert client.calls[0]["params"]["user_id"] == "eq.user-1"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/server/test_open_banking_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'server.open_banking_store'`

- [ ] **Step 3: Implement `server/open_banking_store.py`**

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from .open_banking_crypto import decrypt_token, encrypt_token
from .supabase_store import SupabaseDataError


@dataclass(frozen=True, slots=True)
class OpenBankingConnection:
    id: str
    source_id: str
    status: Literal["active", "revoked"]
    created_at: str


class OpenBankingRepository:
    def __init__(self, client: Any, user_id: str, env: dict[str, str] | None = None) -> None:
        self._client, self._user_id, self._env = client, user_id, env

    def list_connections(self) -> list[OpenBankingConnection]:
        rows = self._client.table_request(
            "GET", "open_banking_connections", operation="open_banking_connections_read",
            params={"user_id": f"eq.{self._user_id}", "select": "*"},
        )
        return [OpenBankingConnection(**row) for row in rows]

    def create_connection(self, source_id: str, refresh_token: str) -> OpenBankingConnection:
        rows = self._client.table_request(
            "POST", "open_banking_connections", operation="open_banking_connection_write",
            params={"select": "*"},
            json={"user_id": self._user_id, "source_id": source_id, "status": "active"},
            prefer="return=representation",
        )
        if not rows:
            raise SupabaseDataError("open_banking_connection_write")
        connection = OpenBankingConnection(**rows[0])
        self.replace_refresh_token(connection.id, refresh_token)
        return connection

    def replace_refresh_token(self, connection_id: str, refresh_token: str) -> None:
        encrypted = encrypt_token(refresh_token, self._env)
        if not encrypted:
            raise SupabaseDataError("open_banking_token_encrypt")
        self._client.table_request(
            "POST", "open_banking_tokens", operation="open_banking_token_write",
            params={"select": "connection_id"},
            json={"connection_id": connection_id, "encrypted_refresh_token": encrypted},
            prefer="return=representation,resolution=merge-duplicates",
        )

    def read_refresh_token(self, connection_id: str) -> str | None:
        rows = self._client.table_request(
            "GET", "open_banking_tokens", operation="open_banking_token_read",
            params={"connection_id": f"eq.{connection_id}", "select": "encrypted_refresh_token", "limit": "1"},
        )
        if not rows:
            return None
        return decrypt_token(rows[0]["encrypted_refresh_token"], self._env)

    def revoke(self, connection_id: str) -> None:
        # The token is deleted first: a connection left briefly in a state that still
        # carries a token but is not yet marked revoked is still only readable by its
        # owner, but a token that no longer works is not worth the risk of holding.
        self._client.table_request(
            "DELETE", "open_banking_tokens", operation="open_banking_token_delete",
            params={"connection_id": f"eq.{connection_id}"}, prefer="return=minimal",
        )
        self._client.table_request(
            "PATCH", "open_banking_connections", operation="open_banking_connection_write",
            params={"id": f"eq.{connection_id}", "user_id": f"eq.{self._user_id}", "select": "*"},
            json={"status": "revoked"}, prefer="return=representation",
        )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/server/test_open_banking_store.py -v`
Expected: PASS

- [ ] **Step 5: Add the new operations to the metrics `Operation` literal**

In `server/supabase_store.py`, widen:
```python
Operation = Literal[
    "profile_read", "profile_write", "snapshot_read", "snapshot_write", "snapshot_delete",
    "consent_read", "consent_write", "consent_withdraw",
    "open_banking_connections_read", "open_banking_connection_write",
    "open_banking_token_read", "open_banking_token_write", "open_banking_token_delete",
]
```

- [ ] **Step 6: Run the full server suite**

Run: `pytest tests/server -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/open_banking_store.py tests/server/test_open_banking_store.py server/supabase_store.py
git commit -m "feat(open-banking): repository for connections and encrypted tokens"
```

---

### Task 6: Consent and OAuth round trip (authorize URL, code/refresh exchange)

**Files:**
- Create: `server/open_banking_flow.py`
- Test: `tests/server/test_open_banking_flow.py`

**Interfaces:**
- Consumes: `OpenBankingSource` (Task 1), `PkceChallenge`/`create_challenge` from `server.auth_flow` (existing, reused as-is — it is already source-agnostic)
- Produces:
  - `authorize_url(source: OpenBankingSource, client_id: str, challenge: PkceChallenge, redirect_uri: str) -> str`
  - `@dataclass TokenPair: access_token: str, refresh_token: str, expires_in: int`
  - `parse_token_response(payload: object) -> TokenPair | None`
  - `exchange_code(source: OpenBankingSource, client_id: str, code: str, verifier: str, redirect_uri: str) -> TokenPair | None`
  - `refresh_tokens(source: OpenBankingSource, client_id: str, refresh_token: str) -> TokenPair | None`

- [ ] **Step 1: Write the failing tests**

```python
# tests/server/test_open_banking_flow.py
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from server.auth_flow import create_challenge
from server.open_banking_config import OpenBankingSource
from server.open_banking_flow import TokenPair, authorize_url, exchange_code, parse_token_response, refresh_tokens

SOURCE = OpenBankingSource(
    id="hapoalim", kind="bank", name="בנק הפועלים",
    base_url="https://api.poalimdev.co.il/psd2/sandbox",
    authorization_url="https://api.poalimdev.co.il/oauth/authorize",
    token_url="https://api.poalimdev.co.il/oauth/token",
)


def test_the_authorize_url_carries_the_pkce_challenge_and_client_id() -> None:
    challenge = create_challenge()

    url = authorize_url(SOURCE, "client-abc", challenge, "https://app.example/api/open-banking/callback")

    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    assert parsed.netloc == "api.poalimdev.co.il"
    assert parsed.path == "/oauth/authorize"
    assert query["client_id"] == ["client-abc"]
    assert query["code_challenge"] == [challenge.challenge]
    assert query["code_challenge_method"] == ["S256"]
    assert query["state"] == [challenge.state]
    assert query["redirect_uri"] == ["https://app.example/api/open-banking/callback"]
    assert query["response_type"] == ["code"]
    assert challenge.verifier not in url


def test_a_token_response_without_both_tokens_is_not_a_pair() -> None:
    assert parse_token_response({"access_token": "a", "expires_in": 3600}) is None
    assert parse_token_response({"refresh_token": "r", "expires_in": 3600}) is None
    assert parse_token_response("not-a-mapping") is None


def test_a_token_pairs_lifetime_is_bounded() -> None:
    pair = parse_token_response({"access_token": "a", "refresh_token": "r", "expires_in": 10_000_000})
    assert pair == TokenPair(access_token="a", refresh_token="r", expires_in=24 * 3600)


def test_exchange_code_posts_the_verifier_and_client_id(monkeypatch) -> None:
    captured = {}

    def fake_post(url, data=None, timeout=None):
        captured["url"] = url
        captured["data"] = data
        return httpx.Response(200, json={"access_token": "a", "refresh_token": "r", "expires_in": 3600})

    monkeypatch.setattr(httpx, "post", fake_post)

    pair = exchange_code(SOURCE, "client-abc", "auth-code", "verifier-value", "https://app.example/callback")

    assert pair == TokenPair(access_token="a", refresh_token="r", expires_in=3600)
    assert captured["url"] == SOURCE.token_url
    assert captured["data"] == {
        "grant_type": "authorization_code", "code": "auth-code", "code_verifier": "verifier-value",
        "redirect_uri": "https://app.example/callback", "client_id": "client-abc",
    }


def test_exchange_code_returns_none_on_a_non_200_or_network_failure(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(400, json={"error": "invalid_grant"}))
    assert exchange_code(SOURCE, "client-abc", "code", "verifier", "https://app.example/callback") is None

    def raise_network_error(*a, **k):
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(httpx, "post", raise_network_error)
    assert exchange_code(SOURCE, "client-abc", "code", "verifier", "https://app.example/callback") is None


def test_refresh_tokens_posts_the_refresh_grant(monkeypatch) -> None:
    captured = {}

    def fake_post(url, data=None, timeout=None):
        captured["data"] = data
        return httpx.Response(200, json={"access_token": "a2", "refresh_token": "r2", "expires_in": 1800})

    monkeypatch.setattr(httpx, "post", fake_post)

    pair = refresh_tokens(SOURCE, "client-abc", "old-refresh-token")

    assert pair == TokenPair(access_token="a2", refresh_token="r2", expires_in=1800)
    assert captured["data"] == {
        "grant_type": "refresh_token", "refresh_token": "old-refresh-token", "client_id": "client-abc",
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/server/test_open_banking_flow.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'server.open_banking_flow'`

- [ ] **Step 3: Implement `server/open_banking_flow.py`**

```python
from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from .auth_flow import PkceChallenge
from .open_banking_config import OpenBankingSource


def authorize_url(source: OpenBankingSource, client_id: str, challenge: PkceChallenge, redirect_uri: str) -> str:
    query = urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "code_challenge": challenge.challenge,
        "code_challenge_method": "S256",
        "state": challenge.state,
    })
    return f"{source.authorization_url}?{query}"


@dataclass(frozen=True, slots=True)
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int


def parse_token_response(payload: object) -> TokenPair | None:
    if not isinstance(payload, dict):
        return None
    access = payload.get("access_token")
    refresh = payload.get("refresh_token")
    expires = payload.get("expires_in")
    if not isinstance(access, str) or not access or not isinstance(refresh, str) or not refresh:
        return None
    if not isinstance(expires, (int, float)) or expires <= 0:
        return None
    # Bounded for the same reason a Google session is: a hostile or misconfigured
    # response must not pin a token open for longer than this process is willing to trust it.
    return TokenPair(access_token=access, refresh_token=refresh, expires_in=min(int(expires), 24 * 3600))


def exchange_code(
    source: OpenBankingSource, client_id: str, code: str, verifier: str, redirect_uri: str,
) -> TokenPair | None:
    try:
        response = httpx.post(
            source.token_url,
            data={
                "grant_type": "authorization_code", "code": code, "code_verifier": verifier,
                "redirect_uri": redirect_uri, "client_id": client_id,
            },
            timeout=8.0,
        )
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    return parse_token_response(response.json())


def refresh_tokens(source: OpenBankingSource, client_id: str, refresh_token: str) -> TokenPair | None:
    try:
        response = httpx.post(
            source.token_url,
            data={"grant_type": "refresh_token", "refresh_token": refresh_token, "client_id": client_id},
            timeout=8.0,
        )
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    return parse_token_response(response.json())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/server/test_open_banking_flow.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/open_banking_flow.py tests/server/test_open_banking_flow.py
git commit -m "feat(open-banking): PKCE authorize URL and token exchange for a source"
```

---

### Task 7: Pull and map XS2A transactions into the domain model

**Files:**
- Create: `server/open_banking_sync.py`
- Test: `tests/server/test_open_banking_sync.py`

**Interfaces:**
- Consumes: `OpenBankingSource` (Task 1), `Transaction` model (existing, widened by Task 2)
- Produces: `pull_transactions(source: OpenBankingSource, access_token: str) -> list[Transaction]`

Field names below follow the Berlin Group NextGenPSD2 shape Bank of Israel's XS2A profile is based on (`transactions.booked[]`, `transactionId`, `bookingDate`, `transactionAmount.amount`/`.currency`, `remittanceInformationUnstructured`). **This must be checked against Bank Hapoalim's actual sandbox response during pilot verification (Task 12)** — if their sandbox differs in field names, this mapper is the only place that needs to change; nothing downstream does.

- [ ] **Step 1: Write the failing tests**

```python
# tests/server/test_open_banking_sync.py
import httpx
import pytest

from server.open_banking_config import OpenBankingSource
from server.open_banking_sync import pull_transactions

SOURCE = OpenBankingSource(
    id="hapoalim", kind="bank", name="בנק הפועלים",
    base_url="https://api.poalimdev.co.il/psd2/sandbox",
    authorization_url="https://api.poalimdev.co.il/oauth/authorize",
    token_url="https://api.poalimdev.co.il/oauth/token",
)

SANDBOX_RESPONSE = {
    "transactions": {
        "booked": [
            {
                "transactionId": "txn-1",
                "bookingDate": "2026-10-04",
                "valueDate": "2026-10-04",
                "transactionAmount": {"amount": "-124.13", "currency": "ILS"},
                "remittanceInformationUnstructured": "הראל-ביטוח בריאות",
            },
            {
                "transactionId": "txn-2",
                "bookingDate": "2026-10-01",
                "valueDate": "2026-10-01",
                "transactionAmount": {"amount": "8500.00", "currency": "ILS"},
                "remittanceInformationUnstructured": "משכורת",
            },
        ],
        "pending": [],
    }
}


def test_booked_transactions_map_into_the_domain_model(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, headers=None, timeout=None: httpx.Response(200, json=SANDBOX_RESPONSE))

    rows = pull_transactions(SOURCE, "access-token")

    assert [row.id for row in rows] == ["txn-1", "txn-2"]
    expense, income = rows
    assert expense.out == 124.13 and expense.incoming == 0
    assert income.out == 0 and income.incoming == 8500.0
    assert expense.src == "open-banking"
    assert expense.source == "bank"
    assert expense.pending is False


def test_pending_transactions_are_included_and_flagged(monkeypatch) -> None:
    response = {
        "transactions": {
            "booked": [],
            "pending": [{
                "transactionId": "txn-3", "bookingDate": "2026-10-06", "valueDate": "2026-10-06",
                "transactionAmount": {"amount": "-9.90", "currency": "ILS"},
                "remittanceInformationUnstructured": "קפה",
            }],
        }
    }
    monkeypatch.setattr(httpx, "get", lambda url, headers=None, timeout=None: httpx.Response(200, json=response))

    rows = pull_transactions(SOURCE, "access-token")

    assert rows[0].pending is True


def test_a_description_carrying_an_identifier_is_redacted_not_stored_raw(monkeypatch) -> None:
    response = {
        "transactions": {
            "booked": [{
                "transactionId": "txn-4", "bookingDate": "2026-10-04", "valueDate": "2026-10-04",
                "transactionAmount": {"amount": "-10.00", "currency": "ILS"},
                "remittanceInformationUnstructured": "חשבון 123-4567890",
            }],
            "pending": [],
        }
    }
    monkeypatch.setattr(httpx, "get", lambda url, headers=None, timeout=None: httpx.Response(200, json=response))

    rows = pull_transactions(SOURCE, "access-token")

    assert "123-4567890" not in rows[0].desc
    assert "[redacted]" in rows[0].desc or "redacted" in rows[0].desc.lower()


def test_a_non_200_response_yields_no_rows_rather_than_raising(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, headers=None, timeout=None: httpx.Response(401, json={"error": "invalid_token"}))
    assert pull_transactions(SOURCE, "access-token") == []


def test_a_row_that_fails_model_validation_is_dropped_not_fatal(monkeypatch) -> None:
    response = {
        "transactions": {
            "booked": [
                {"transactionId": "txn-5", "bookingDate": "2026-10-04", "valueDate": "2026-10-04",
                 "transactionAmount": {"amount": "not-a-number", "currency": "ILS"},
                 "remittanceInformationUnstructured": "broken row"},
                {"transactionId": "txn-6", "bookingDate": "2026-10-04", "valueDate": "2026-10-04",
                 "transactionAmount": {"amount": "-5.00", "currency": "ILS"},
                 "remittanceInformationUnstructured": "good row"},
            ],
            "pending": [],
        }
    }
    monkeypatch.setattr(httpx, "get", lambda url, headers=None, timeout=None: httpx.Response(200, json=response))

    rows = pull_transactions(SOURCE, "access-token")

    assert [row.id for row in rows] == ["txn-6"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/server/test_open_banking_sync.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'server.open_banking_sync'`

- [ ] **Step 3: Implement `server/open_banking_sync.py`**

`Transaction.description_has_no_financial_identifier` *rejects* a description carrying an identifier rather than redacting it — validating a raw XS2A description directly would drop the whole row with a `ValidationError` instead of keeping it with the identifier removed. So the mapper redacts first, then validates, using the same pattern list `server/models.py` already defines. This duplicates that list rather than importing a private name across modules — acceptable because the two call sites diverge in behaviour (one rejects, one redacts) and the patterns are a stable, independently-tested contract; if the two lists ever drift apart in review, that is the sign to extract a shared `server/financial_identifiers.py`, not needed yet.

```python
from __future__ import annotations

import re

import httpx
from pydantic import ValidationError

from .models import Transaction
from .open_banking_config import OpenBankingSource

_REDACTED = "[redacted]"
_FINANCIAL_IDENTIFIERS = (
    re.compile(r"\b(?:IBAN\s*)?[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b", re.IGNORECASE),
    re.compile(r"\b(?:cvv|cvc|security\s*code)\s*[:#-]?\s*\d{3,4}\b", re.IGNORECASE),
    re.compile(r"\b(?:\d[ -]?){12,18}\d\b"),
    re.compile(r"\b\d{1,3}[- ]\d{1,4}[- ]\d{4,10}\b"),
    re.compile(
        r"\b(?:חשבון|חשבונות|בנק|סניף|כרטיס|account|acct|branch|card|מספר|no|nr)[\s:.#-]*"
        r"\d[\d-]{3,12}\d\b(?![.,]\d)",
        re.IGNORECASE,
    ),
)


def _redact(value: str) -> str:
    for pattern in _FINANCIAL_IDENTIFIERS:
        value = pattern.sub(_REDACTED, value)
    return value


def _to_row(raw: dict, *, pending: bool) -> Transaction | None:
    amount = raw.get("transactionAmount", {})
    try:
        signed = float(amount.get("amount", ""))
    except (TypeError, ValueError):
        return None
    desc = _redact(str(raw.get("remittanceInformationUnstructured", "")))
    try:
        return Transaction.model_validate({
            "date": raw.get("bookingDate", ""),
            "vdate": raw.get("valueDate", raw.get("bookingDate", "")),
            "ref": "",
            "desc": desc,
            "out": max(0.0, -signed),
            "in": max(0.0, signed),
            "bal": None,
            "pending": pending,
            "source": "bank",
            "src": "open-banking",
            "id": raw.get("transactionId"),
        })
    except ValidationError:
        return None


def pull_transactions(source: OpenBankingSource, access_token: str) -> list[Transaction]:
    try:
        response = httpx.get(
            f"{source.base_url}/accounts/transactions",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10.0,
        )
    except httpx.HTTPError:
        return []
    if response.status_code != 200:
        return []
    body = response.json()
    transactions = body.get("transactions", {})
    rows = []
    for raw in transactions.get("booked", []):
        row = _to_row(raw, pending=False)
        if row:
            rows.append(row)
    for raw in transactions.get("pending", []):
        row = _to_row(raw, pending=True)
        if row:
            rows.append(row)
    return rows
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/server/test_open_banking_sync.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/open_banking_sync.py tests/server/test_open_banking_sync.py
git commit -m "feat(open-banking): pull and map XS2A transactions into the domain model"
```

---

### Task 8: Routes — consent, connect, callback, connections, sync, revoke

**Files:**
- Create: `server/open_banking_routes.py`
- Modify: `server/app.py`
- Test: `tests/server/test_open_banking_routes.py`

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 5, 6, 7. The router defines its own `_error`/`_authenticated_client` rather than importing `app.py`'s private (`_`-prefixed) versions, since those are scoped to that module's own cookie/landing conventions.
- Produces: `router: APIRouter` mounted at `app.include_router(open_banking_router)` in `app.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/server/test_open_banking_routes.py
from fastapi.testclient import TestClient

import server.app as app_module
import server.open_banking_routes as routes_module
from server.app import app
from server.open_banking_config import OpenBankingSource
from server.open_banking_flow import TokenPair
from server.open_banking_store import OpenBankingConnection

client = TestClient(app)

SOURCE = OpenBankingSource(
    id="hapoalim", kind="bank", name="בנק הפועלים",
    base_url="https://api.poalimdev.co.il/psd2/sandbox",
    authorization_url="https://api.poalimdev.co.il/oauth/authorize",
    token_url="https://api.poalimdev.co.il/oauth/token",
)


def test_sources_lists_nothing_when_unconfigured(monkeypatch) -> None:
    monkeypatch.setattr(routes_module, "read_sources", lambda: [])
    response = client.get("/api/open-banking/sources")
    assert response.status_code == 200
    assert response.json() == {"sources": []}


def test_sources_marks_each_source_sandbox_or_production(monkeypatch) -> None:
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(routes_module, "sandbox_enabled", lambda: True)
    monkeypatch.setattr(routes_module, "licence_id", lambda: None)
    response = client.get("/api/open-banking/sources")
    assert response.json() == {"sources": [{"id": "hapoalim", "name": "בנק הפועלים", "kind": "bank", "mode": "sandbox"}]}


def test_connect_refuses_a_non_sandbox_call_without_a_licence(monkeypatch) -> None:
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(routes_module, "sandbox_enabled", lambda: False)
    monkeypatch.setattr(routes_module, "licence_id", lambda: None)
    response = client.get("/api/open-banking/connect/hapoalim", follow_redirects=False)
    assert response.status_code == 503
    assert response.json() == {"code": "open_banking_not_configured"}


def test_connect_redirects_to_the_sources_authorize_url_in_sandbox_mode(monkeypatch) -> None:
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(routes_module, "sandbox_enabled", lambda: True)
    monkeypatch.setattr(routes_module, "licence_id", lambda: None)
    monkeypatch.setattr(routes_module, "client_id_for", lambda source_id: "client-abc")
    response = client.get("/api/open-banking/connect/hapoalim", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"].startswith(SOURCE.authorization_url)


def test_connect_with_an_unknown_source_id_is_not_found(monkeypatch) -> None:
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(routes_module, "sandbox_enabled", lambda: True)
    response = client.get("/api/open-banking/connect/unknown", follow_redirects=False)
    assert response.status_code == 404


class FakeAuthenticatedClient:
    def verify_user(self) -> str:
        return "user-1"


def authenticate(monkeypatch) -> None:
    monkeypatch.setattr(app_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(app_module, "SupabaseRestClient", lambda _config, _token: FakeAuthenticatedClient())


def test_connections_requires_authentication(monkeypatch) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    response = client.get("/api/open-banking/connections")
    assert response.status_code == 503
    assert response.json() == {"code": "cloud_not_configured"}


def test_connections_list_never_carries_a_token_field(monkeypatch) -> None:
    authenticate(monkeypatch)
    monkeypatch.setattr(
        routes_module, "OpenBankingRepository",
        lambda client, user_id, env=None: type("R", (), {
            "list_connections": lambda self: [OpenBankingConnection(id="conn-1", source_id="hapoalim", status="active", created_at="2026-10-07T00:00:00Z")],
        })(),
    )
    response = client.get(
        "/api/open-banking/connections", headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 200
    body_text = response.text
    assert "refresh" not in body_text.lower() and "token" not in body_text.lower()
    assert response.json() == {"connections": [{"id": "conn-1", "sourceId": "hapoalim", "status": "active", "createdAt": "2026-10-07T00:00:00Z"}]}


def test_sync_requires_open_banking_consent(monkeypatch) -> None:
    authenticate(monkeypatch)
    monkeypatch.setattr(
        routes_module, "ConsentRepository",
        lambda client, user_id, purpose="cloud_sync": type("C", (), {"read": lambda self, version: None})(),
    )
    response = client.post(
        "/api/open-banking/sync/conn-1", headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 403
    assert response.json() == {"code": "open_banking_consent_required"}


def test_sync_pulls_refreshes_and_returns_mapped_transactions(monkeypatch) -> None:
    authenticate(monkeypatch)
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(
        routes_module, "ConsentRepository",
        lambda client, user_id, purpose="cloud_sync": type("C", (), {
            "read": lambda self, version: type("A", (), {"withdrawn_at": None})(),
        })(),
    )

    class FakeRepository:
        def list_connections(self):
            return [OpenBankingConnection(id="conn-1", source_id="hapoalim", status="active", created_at="2026-10-07T00:00:00Z")]

        def read_refresh_token(self, connection_id: str) -> str:
            return "stored-refresh-token"

        def replace_refresh_token(self, connection_id: str, refresh_token: str) -> None:
            pass

    monkeypatch.setattr(routes_module, "OpenBankingRepository", lambda client, user_id, env=None: FakeRepository())
    monkeypatch.setattr(routes_module, "client_id_for", lambda source_id: "client-abc")
    monkeypatch.setattr(routes_module, "refresh_tokens", lambda source, client_id, refresh_token: TokenPair(access_token="access-1", refresh_token="refresh-2", expires_in=3600))

    from server.models import Transaction
    mapped = Transaction.model_validate({
        "date": "2026-10-04", "vdate": "2026-10-04", "ref": "", "desc": "Groceries",
        "out": 42.0, "in": 0.0, "bal": None, "pending": False, "source": "bank",
        "src": "open-banking", "id": "txn-1",
    })
    monkeypatch.setattr(routes_module, "pull_transactions", lambda source, access_token: [mapped])

    response = client.post(
        "/api/open-banking/sync/conn-1", headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["transactions"][0]["id"] == "txn-1"
    assert "refresh" not in response.text.lower()


def test_revoke_calls_the_repository_and_returns_no_content(monkeypatch) -> None:
    authenticate(monkeypatch)
    revoked = {}
    monkeypatch.setattr(
        routes_module, "OpenBankingRepository",
        lambda client, user_id, env=None: type("R", (), {"revoke": lambda self, connection_id: revoked.setdefault("id", connection_id)})(),
    )
    response = client.delete(
        "/api/open-banking/connections/conn-1", headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 204
    assert revoked == {"id": "conn-1"}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/server/test_open_banking_routes.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'server.open_banking_routes'`

- [ ] **Step 3: Implement `server/open_banking_routes.py`**

```python
from __future__ import annotations

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.concurrency import run_in_threadpool

from .auth_flow import create_challenge
from .config import bearer_token, read_supabase_config
from .open_banking_config import client_id_for, licence_id, read_sources, sandbox_enabled
from .open_banking_flow import authorize_url, exchange_code, refresh_tokens
from .open_banking_store import OpenBankingRepository
from .open_banking_sync import pull_transactions
from .supabase_store import ConsentRepository, SupabaseDataError, SupabaseRestClient

router = APIRouter()

OPEN_BANKING_CONSENT_VERSION = "open-banking-v1-read-only-2026-10-07"
STATE_COOKIE = "he_ob_state"
VERIFIER_COOKIE = "he_ob_pkce"
SOURCE_COOKIE = "he_ob_source"
STATE_TTL_SECONDS = 600


def _error(status: int, code: str) -> JSONResponse:
    return JSONResponse({"code": code}, status_code=status)


def _source_or_none(source_id: str):
    return next((source for source in read_sources() if source.id == source_id), None)


async def _authenticated_client(request: Request):
    config = read_supabase_config()
    if not config:
        return _error(503, "cloud_not_configured")
    token = bearer_token(request.headers.get("authorization"))
    if not token:
        return _error(401, "authentication_required")
    client = SupabaseRestClient(config, token)
    user_id = await run_in_threadpool(client.verify_user)
    if not user_id:
        return _error(401, "invalid_session")
    return client, user_id


@router.get("/api/open-banking/sources")
async def sources() -> Response:
    mode = "sandbox" if sandbox_enabled() else ("production" if licence_id() else "unavailable")
    return JSONResponse({"sources": [
        {"id": s.id, "name": s.name, "kind": s.kind, "mode": mode} for s in read_sources()
    ]})


@router.get("/api/open-banking/connect/{source_id}")
async def connect(source_id: str, request: Request) -> Response:
    source = _source_or_none(source_id)
    if not source:
        return _error(404, "open_banking_source_not_found")
    if not sandbox_enabled() and not licence_id():
        return _error(503, "open_banking_not_configured")
    client_id = client_id_for(source_id)
    if not client_id:
        return _error(503, "open_banking_not_configured")

    challenge = create_challenge()
    redirect_uri = f"{request.url.scheme}://{request.url.netloc}/api/open-banking/callback"
    response = RedirectResponse(authorize_url(source, client_id, challenge, redirect_uri), status_code=302)
    response.set_cookie(VERIFIER_COOKIE, challenge.verifier, max_age=STATE_TTL_SECONDS, httponly=True, secure=True, samesite="lax", path="/")
    response.set_cookie(STATE_COOKIE, challenge.state, max_age=STATE_TTL_SECONDS, httponly=True, secure=True, samesite="lax", path="/")
    response.set_cookie(SOURCE_COOKIE, source_id, max_age=STATE_TTL_SECONDS, httponly=True, secure=True, samesite="lax", path="/")
    return response


@router.get("/api/open-banking/callback")
async def callback(request: Request) -> Response:
    source_id = request.cookies.get(SOURCE_COOKIE)
    verifier = request.cookies.get(VERIFIER_COOKIE)
    state = request.cookies.get(STATE_COOKIE)
    code = request.query_params.get("code")
    if not source_id or not verifier or not state or not code or state != request.query_params.get("state"):
        return _error(400, "open_banking_state_mismatch")
    source = _source_or_none(source_id)
    client_id = client_id_for(source_id) if source else None
    if not source or not client_id:
        return _error(503, "open_banking_not_configured")

    redirect_uri = f"{request.url.scheme}://{request.url.netloc}/api/open-banking/callback"
    pair = await run_in_threadpool(exchange_code, source, client_id, code, verifier, redirect_uri)
    if pair is None:
        return _error(502, "open_banking_exchange_failed")

    authenticated = await _authenticated_client(request)
    if isinstance(authenticated, JSONResponse):
        return authenticated
    client, user_id = authenticated
    repository = OpenBankingRepository(client, user_id)
    try:
        await run_in_threadpool(repository.create_connection, source_id, pair.refresh_token)
    except SupabaseDataError:
        return _error(502, "open_banking_connection_failed")

    # Unlike Google sign-in, nothing here carries a caller-supplied `next` target — the
    # landing page is fixed, so there is no open-redirect surface to check.
    response = RedirectResponse("/mazan-habait.html", status_code=302)
    for cookie in (VERIFIER_COOKIE, STATE_COOKIE, SOURCE_COOKIE):
        response.delete_cookie(cookie, path="/")
    return response


@router.get("/api/open-banking/connections")
async def connections(request: Request) -> Response:
    authenticated = await _authenticated_client(request)
    if isinstance(authenticated, JSONResponse):
        return authenticated
    client, user_id = authenticated
    repository = OpenBankingRepository(client, user_id)
    try:
        rows = await run_in_threadpool(repository.list_connections)
    except SupabaseDataError:
        return _error(502, "open_banking_connections_read_failed")
    return JSONResponse({"connections": [
        {"id": c.id, "sourceId": c.source_id, "status": c.status, "createdAt": c.created_at} for c in rows
    ]})


@router.post("/api/open-banking/sync/{connection_id}")
async def sync(connection_id: str, request: Request) -> Response:
    authenticated = await _authenticated_client(request)
    if isinstance(authenticated, JSONResponse):
        return authenticated
    client, user_id = authenticated

    try:
        consent = await run_in_threadpool(
            ConsentRepository(client, user_id, purpose="open_banking").read, OPEN_BANKING_CONSENT_VERSION,
        )
    except SupabaseDataError:
        return _error(502, "open_banking_consent_check_failed")
    if not consent or consent.withdrawn_at is not None:
        return _error(403, "open_banking_consent_required")

    repository = OpenBankingRepository(client, user_id)
    try:
        target = next((c for c in await run_in_threadpool(repository.list_connections) if c.id == connection_id), None)
        if not target:
            return _error(404, "open_banking_connection_not_found")
        source = _source_or_none(target.source_id)
        client_id = client_id_for(target.source_id) if source else None
        if not source or not client_id:
            return _error(503, "open_banking_not_configured")

        stored_refresh_token = await run_in_threadpool(repository.read_refresh_token, connection_id)
        if not stored_refresh_token:
            return _error(502, "open_banking_token_missing")
        pair = await run_in_threadpool(refresh_tokens, source, client_id, stored_refresh_token)
        if pair is None:
            return _error(502, "open_banking_refresh_failed")
        await run_in_threadpool(repository.replace_refresh_token, connection_id, pair.refresh_token)
    except SupabaseDataError:
        return _error(502, "open_banking_sync_failed")

    # pull_transactions (Task 7) already turns a network failure or non-200 response into
    # an empty list rather than raising, so an empty sync result and a failed one are the
    # same thing here — there is nothing further to catch.
    rows = await run_in_threadpool(pull_transactions, source, pair.access_token)
    return JSONResponse({"transactions": [row.model_dump(by_alias=True, exclude_none=True) for row in rows]})


@router.delete("/api/open-banking/connections/{connection_id}")
async def revoke(connection_id: str, request: Request) -> Response:
    authenticated = await _authenticated_client(request)
    if isinstance(authenticated, JSONResponse):
        return authenticated
    client, user_id = authenticated
    repository = OpenBankingRepository(client, user_id)
    try:
        await run_in_threadpool(repository.revoke, connection_id)
    except SupabaseDataError:
        return _error(502, "open_banking_revoke_failed")
    return Response(status_code=204)


@router.put("/api/consents/open-banking")
async def accept_consent(request: Request) -> Response:
    from .app import _small_json_body
    from .models import CloudConsentInput

    consent_input = await _small_json_body(request, CloudConsentInput)
    if isinstance(consent_input, JSONResponse):
        return consent_input
    authenticated = await _authenticated_client(request)
    if isinstance(authenticated, JSONResponse):
        return authenticated
    client, user_id = authenticated
    try:
        value = await run_in_threadpool(
            ConsentRepository(client, user_id, purpose="open_banking").accept,
            OPEN_BANKING_CONSENT_VERSION, consent_input.locale,  # type: ignore[union-attr]
        )
    except SupabaseDataError:
        return _error(502, "open_banking_consent_write_failed")
    return JSONResponse({"consent": {
        "purpose": value.purpose, "statementVersion": value.statement_version, "locale": value.locale,
        "acceptedAt": value.accepted_at.isoformat(),
        "withdrawnAt": value.withdrawn_at.isoformat() if value.withdrawn_at else None,
    }})
```

- [ ] **Step 4: Mount the router in `server/app.py`**

Add near the other imports:
```python
from .open_banking_routes import router as open_banking_router
```
Add immediately after `app = FastAPI(...)`:
```python
app.include_router(open_banking_router)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pytest tests/server/test_open_banking_routes.py -v`
Expected: PASS

- [ ] **Step 6: Run the full server suite**

Run: `pytest tests/server -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/open_banking_routes.py server/app.py tests/server/test_open_banking_routes.py
git commit -m "feat(open-banking): wire consent, connect, callback, connections, sync and revoke routes"
```

---

### Task 9: Browser allowlist recognises `src: 'open-banking'`

**Files:**
- Modify: `fe/src/privacy.ts`
- Modify: `tests/unit/privacy.unit.test.ts`

**Interfaces:**
- Produces: `sanitizeTransaction` preserves `src: 'open-banking'` when given it; `PersistedTransaction.src` widened; `isPrivacySafeTransaction` accepts it

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/privacy.unit.test.ts`, beside the existing `sanitizeTransaction` tests:

```ts
it('preserves the open-banking provenance rather than relabelling it as a bank report', () => {
  const sanitized = sanitizeTransaction({
    date: '2026-10-04', vdate: '2026-10-04', desc: 'Groceries', out: 42, in: 0,
    bal: null, pending: false, source: 'bank', src: 'open-banking', id: 'txn-1',
  });
  expect(sanitized.src).toBe('open-banking');
});

it('accepts open-banking as a safe source for the cloud snapshot', () => {
  expect(isPrivacySafeTransaction({
    ref: '', src: 'open-banking', desc: 'Groceries', out: 42, in: 0, bal: null, pending: false,
  })).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/privacy.unit.test.ts`
Expected: FAIL — `sanitized.src` is `'bank-report'`, not `'open-banking'`

- [ ] **Step 3: Update `fe/src/privacy.ts`**

Change line 24:
```ts
export interface PersistedTransaction extends BankTransaction {
  ref: '';
  src: 'bank-report' | 'card-report' | 'manual-entry' | 'open-banking';
}
```
Change line 44:
```ts
const SAFE_SOURCES = new Set(['bank-report', 'card-report', 'manual-entry', 'open-banking']);
```
Change the `source` derivation in `sanitizeTransaction` (lines 62–65):
```ts
const source = transaction.src === 'open-banking' ? 'open-banking'
  : transaction.source === 'card' ? 'card-report'
    : transaction.src === 'הזנה ידנית' || transaction.src === 'manual-entry' ? 'manual-entry'
      : 'bank-report';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/privacy.unit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fe/src/privacy.ts tests/unit/privacy.unit.test.ts
git commit -m "feat(open-banking): let the privacy boundary recognise open-banking provenance"
```

---

### Task 10: Browser client for the open-banking API

**Files:**
- Create: `fe/src/open-banking.ts`
- Test: `tests/unit/open-banking.unit.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `interface OpenBankingSourceInfo { id: string; name: string; kind: 'bank' | 'card_issuer'; mode: 'sandbox' | 'production' | 'unavailable' }`
  - `interface OpenBankingConnectionInfo { id: string; sourceId: string; status: 'active' | 'revoked'; createdAt: string }`
  - `class OpenBankingError extends Error { code: string; status: number }`
  - `class OpenBankingClient { listSources(): Promise<OpenBankingSourceInfo[]>; listConnections(): Promise<OpenBankingConnectionInfo[]>; sync(connectionId: string): Promise<BankTransaction[]>; disconnect(connectionId: string): Promise<void>; connectHref(sourceId: string): string }`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/open-banking.unit.test.ts
import { describe, expect, it, vi } from 'vitest';
import { OpenBankingClient, OpenBankingError } from '../../fe/src/open-banking';

describe('open banking client', () => {
  it('builds the connect href from the source id, no fetch involved', () => {
    const client = new OpenBankingClient({ accessToken: async () => 'token', fetchImpl: vi.fn() as typeof fetch });
    expect(client.connectHref('hapoalim')).toBe('/api/open-banking/connect/hapoalim');
  });

  it('lists sources without requiring a signed-in session', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ sources: [{ id: 'hapoalim', name: 'בנק הפועלים', kind: 'bank', mode: 'sandbox' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const client = new OpenBankingClient({ accessToken: async () => null, fetchImpl: fetchImpl as typeof fetch });

    const sources = await client.listSources();

    expect(sources).toEqual([{ id: 'hapoalim', name: 'בנק הפועלים', kind: 'bank', mode: 'sandbox' }]);
    expect(fetchImpl).toHaveBeenCalledWith('/api/open-banking/sources', expect.objectContaining({ method: 'GET' }));
  });

  it('fails before a request when listing connections signed out', async () => {
    const fetchImpl = vi.fn();
    const client = new OpenBankingClient({ accessToken: async () => null, fetchImpl });

    await expect(client.listConnections()).rejects.toMatchObject({ code: 'authentication_required', status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the bearer token and returns mapped transactions on sync', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer user.jwt.token' });
      return new Response(
        JSON.stringify({ transactions: [{ date: '2026-10-04', vdate: '2026-10-04', ref: '', desc: 'Groceries', out: 42, in: 0, bal: null, pending: false, source: 'bank', src: 'open-banking', id: 'txn-1' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const client = new OpenBankingClient({ accessToken: async () => 'user.jwt.token', fetchImpl: fetchImpl as typeof fetch });

    const rows = await client.sync('conn-1');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'txn-1', src: 'open-banking' });
  });

  it('maps a non-OK sync response to a stable error', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 'open_banking_refresh_failed' }), { status: 502 }));
    const client = new OpenBankingClient({ accessToken: async () => 'token', fetchImpl: fetchImpl as typeof fetch });

    await expect(client.sync('conn-1')).rejects.toMatchObject(
      new OpenBankingError('open_banking_refresh_failed', 'Open Banking sync failed.', 502),
    );
  });

  it('disconnects with DELETE and no body', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init).toMatchObject({ method: 'DELETE', body: undefined });
      return new Response(null, { status: 204 });
    });
    const client = new OpenBankingClient({ accessToken: async () => 'token', fetchImpl: fetchImpl as typeof fetch });

    await expect(client.disconnect('conn-1')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/open-banking.unit.test.ts`
Expected: FAIL with `Cannot find module '../../fe/src/open-banking'`

- [ ] **Step 3: Implement `fe/src/open-banking.ts`**

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

  constructor(private readonly input: {
    accessToken: () => Promise<string | null>;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
    this.fetchImpl = input.fetchImpl || fetch;
  }

  connectHref(sourceId: string): string {
    return `/api/open-banking/connect/${encodeURIComponent(sourceId)}`;
  }

  private async request(
    method: 'GET' | 'POST' | 'DELETE', path: string, options: { authenticated?: boolean } = {},
  ): Promise<Record<string, unknown> | null> {
    const headers: Record<string, string> = {};
    if (options.authenticated !== false) {
      const token = await this.input.accessToken();
      if (!token) throw new OpenBankingError('authentication_required', 'Sign in before using Open Banking.', HttpStatus.UNAUTHORIZED);
      headers.Authorization = `Bearer ${token}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.input.timeoutMs ?? 10_000);
    let response: Response;
    try {
      response = await this.fetchImpl(path, { method, credentials: 'omit', signal: controller.signal, headers });
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
    const body = await this.request('GET', '/api/open-banking/sources', { authenticated: false });
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/open-banking.unit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fe/src/open-banking.ts tests/unit/open-banking.unit.test.ts
git commit -m "feat(open-banking): browser client for sources, connections, sync and disconnect"
```

---

### Task 11: Merge synced transactions into application state by id

**Files:**
- Create: `fe/src/open-banking-sync.ts`
- Test: `tests/unit/open-banking-sync.unit.test.ts`

**Interfaces:**
- Consumes: `BankTransaction` (existing)
- Produces: `mergeSyncedTransactions(existing: readonly BankTransaction[], incoming: readonly BankTransaction[]): { merged: BankTransaction[]; added: number; duplicates: number }`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/open-banking-sync.unit.test.ts
import { describe, expect, it } from 'vitest';
import { mergeSyncedTransactions } from '../../fe/src/open-banking-sync';
import type { BankTransaction } from '../../fe/src/domain-model';

const row = (id: string, desc = 'Groceries'): BankTransaction => ({
  date: '2026-10-04', vdate: '2026-10-04', ref: '', desc, out: 42, in: 0, bal: null,
  pending: false, source: 'bank', src: 'open-banking', id,
});

describe('merging synced transactions', () => {
  it('adds every row the first time', () => {
    const result = mergeSyncedTransactions([], [row('txn-1'), row('txn-2')]);
    expect(result.merged).toHaveLength(2);
    expect(result.added).toBe(2);
    expect(result.duplicates).toBe(0);
  });

  it('does not duplicate a row already present by id, syncing twice', () => {
    const existing = [row('txn-1')];
    const result = mergeSyncedTransactions(existing, [row('txn-1'), row('txn-2')]);
    expect(result.merged.map((t) => t.id)).toEqual(['txn-1', 'txn-2']);
    expect(result.added).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  it('does not duplicate a row the same id already imported from a manual statement', () => {
    const existing: BankTransaction[] = [{ ...row('txn-1'), src: 'bank-report' }];
    const result = mergeSyncedTransactions(existing, [row('txn-1')]);
    expect(result.merged).toHaveLength(1);
    expect(result.added).toBe(0);
    expect(result.duplicates).toBe(1);
    // The pre-existing row is left exactly as it was — sync adds, it never overwrites.
    expect(result.merged[0]!.src).toBe('bank-report');
  });

  it('leaves unrelated existing transactions untouched', () => {
    const unrelated = row('txn-9', 'Rent');
    const result = mergeSyncedTransactions([unrelated], [row('txn-1')]);
    expect(result.merged).toEqual([unrelated, row('txn-1')]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/open-banking-sync.unit.test.ts`
Expected: FAIL with `Cannot find module '../../fe/src/open-banking-sync'`

- [ ] **Step 3: Implement `fe/src/open-banking-sync.ts`**

```ts
import type { BankTransaction } from './domain-model.js';

export function mergeSyncedTransactions(
  existing: readonly BankTransaction[], incoming: readonly BankTransaction[],
): { merged: BankTransaction[]; added: number; duplicates: number } {
  const have = new Set(existing.map((t) => t.id).filter((id): id is string => Boolean(id)));
  const merged = [...existing];
  let added = 0, duplicates = 0;
  for (const transaction of incoming) {
    if (transaction.id && have.has(transaction.id)) { duplicates++; continue; }
    if (transaction.id) have.add(transaction.id);
    merged.push(transaction);
    added++;
  }
  return { merged, added, duplicates };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/open-banking-sync.unit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fe/src/open-banking-sync.ts tests/unit/open-banking-sync.unit.test.ts
git commit -m "feat(open-banking): merge synced transactions by id without duplicating"
```

---

### Task 12: "Connect a bank" entry point and connections panel

**Files:**
- Modify: `fe/mazan-habait.html`
- Modify: `fe/src/app.ts`
- Modify: `fe/resources/he.json`, `fe/resources/en.json`, `fe/resources/am.json`, `fe/resources/fr.json`
- Test: `tests/component/open-banking-panel.component.test.ts` (new — follow the existing component test harness in `tests/component/`)

**Interfaces:**
- Consumes: `OpenBankingClient` (Task 10), `mergeSyncedTransactions` (Task 11)
- Produces: a rendered connections panel wired to live DOM events

This repo's `tests/component/*.test.ts` files do not mount `app.ts` or stub `fetch` — they load the static `fe/mazan-habait.html` through `JSDOM` and assert on markup and `data-i18n` keys directly (see `tests/component/cloud-consent.component.test.ts`). This task's test follows that exact, simpler pattern; the interactive click-handler behavior wired in Step 6 is exercised by the manual sandbox run in Step 9, not by this test.

- [ ] **Step 1: Write the failing component test**

```ts
// tests/component/open-banking-panel.component.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

describe('open banking connect panel', () => {
  it('shows a Connect a bank trigger beside the existing import buttons', () => {
    const html = readFileSync(resolve(__dirname, '../../fe/mazan-habait.html'), 'utf8');
    const document = new JSDOM(html).window.document;

    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="open-banking-trigger"]')!;
    const cardTrigger = document.querySelector('[data-testid="card-upload-trigger"]')!;

    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.querySelector('[data-i18n="openBankingConnect"]')).not.toBeNull();
    // Beside the existing import buttons: same parent, same toolbar.
    expect(trigger.parentElement).toBe(cardTrigger.parentElement);
  });

  it('starts with the connections panel hidden and empty', () => {
    const html = readFileSync(resolve(__dirname, '../../fe/mazan-habait.html'), 'utf8');
    const document = new JSDOM(html).window.document;

    const panel = document.querySelector<HTMLElement>('[data-testid="open-banking-panel"]')!;

    expect(panel).not.toBeNull();
    expect(panel.hidden).toBe(true);
    expect(panel.textContent?.trim()).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/component/open-banking-panel.component.test.ts`
Expected: FAIL — `trigger` is `null`

- [ ] **Step 3: Add the button and panel markup to `fe/mazan-habait.html`**

Immediately after the existing card-upload `<input type="file" id="card-file" ...>` line (around line 962), add:

```html
<button class="btn" id="btn-open-banking" type="button" aria-haspopup="dialog" data-testid="open-banking-trigger">
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 8l7-5 7 5M4 8v7h12V8M8 15v-4h4v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <span data-i18n="openBankingConnect">חיבור לבנק</span>
</button>
<div id="open-banking-panel" class="open-banking-panel" hidden data-testid="open-banking-panel"></div>
```

- [ ] **Step 4: Add resource strings**

In `fe/resources/he.json`, add beside `cardUpload`:
```json
"openBankingConnect": "חיבור לבנק",
"openBankingConnected": "מחובר",
"openBankingSyncNow": "סנכרון עכשיו",
"openBankingDisconnect": "ניתוק",
"openBankingSandboxLabel": "סביבת בדיקה",
"openBankingSyncResult": "נוספו {added} תנועות, {duplicates} כבר היו קיימות"
```
In `fe/resources/en.json`:
```json
"openBankingConnect": "Connect a bank",
"openBankingConnected": "Connected",
"openBankingSyncNow": "Sync now",
"openBankingDisconnect": "Disconnect",
"openBankingSandboxLabel": "Sandbox",
"openBankingSyncResult": "{added} transactions added, {duplicates} already present"
```
Add the same six keys, translated, to `fe/resources/am.json` and `fe/resources/fr.json` — flag these two for a native-speaker review before release; use the English strings as literal placeholders if no reliable translation is available rather than guessing at Amharic/French financial terminology.

- [ ] **Step 5: Wire the panel in `fe/src/app.ts`**

Add near the other module-level state (beside `openCardGroups`/`openBills`):

```ts
import { OpenBankingClient, type OpenBankingConnectionInfo, type OpenBankingSourceInfo } from './open-banking.js';
import { mergeSyncedTransactions } from './open-banking-sync.js';

const openBankingClient = new OpenBankingClient({ accessToken: () => currentAccessToken() });
let openBankingSources: OpenBankingSourceInfo[] = [];
let openBankingConnections: OpenBankingConnectionInfo[] = [];
```

(`currentAccessToken` is the existing accessor `cloud-sync.ts`'s wiring already uses to read the signed-in session's token — reuse it rather than inventing a second one; find it where `SupabaseSnapshotRepository` is constructed in `app.ts` and call the same function.)

Add a render function and the click handlers:

```ts
async function renderOpenBankingPanel() {
  const panel = $('#open-banking-panel');
  panel.textContent = '';
  if (!openBankingSources.length) { panel.hidden = true; return; }
  panel.hidden = false;
  for (const source of openBankingSources) {
    const connection = openBankingConnections.find((c) => c.sourceId === source.id && c.status === 'active');
    const row = el('div', { class: 'open-banking-row' }, [
      el('span', { text: source.name }),
      source.mode === 'sandbox' ? el('span', { class: 'badge', text: t('openBankingSandboxLabel') }) : null,
    ].filter(Boolean) as DomElement[]);
    if (connection) {
      const syncBtn = el('button', { type: 'button', text: t('openBankingSyncNow'), 'data-testid': 'open-banking-sync' });
      syncBtn.addEventListener('click', () => void syncOpenBankingConnection(connection.id));
      const disconnectBtn = el('button', { type: 'button', text: t('openBankingDisconnect'), 'data-testid': 'open-banking-disconnect' });
      disconnectBtn.addEventListener('click', () => void disconnectOpenBanking(connection.id));
      row.append(syncBtn, disconnectBtn);
    } else {
      const connectLink = el('a', { href: openBankingClient.connectHref(source.id), text: t('openBankingConnect') });
      row.append(connectLink);
    }
    panel.append(row);
  }
}

async function syncOpenBankingConnection(connectionId: string) {
  try {
    const rows = await openBankingClient.sync(connectionId);
    const { merged, added, duplicates } = mergeSyncedTransactions(S.tx, rows);
    S.tx = merged;
    save();
    S.month = null;
    render();
    toast(t('openBankingSyncResult', { added, duplicates }));
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : t('openBankingSyncResult', { added: 0, duplicates: 0 }));
  }
}

async function disconnectOpenBanking(connectionId: string) {
  await openBankingClient.disconnect(connectionId);
  openBankingConnections = await openBankingClient.listConnections();
  await renderOpenBankingPanel();
}

async function loadOpenBankingPanel() {
  openBankingSources = await openBankingClient.listSources().catch(() => []);
  openBankingConnections = await openBankingClient.listConnections().catch(() => []);
  await renderOpenBankingPanel();
}
```

Call `void loadOpenBankingPanel();` once during startup, beside wherever the app currently loads the cloud-sync/consent state on boot (find that call and add this line immediately after it, so both load as part of the same startup sequence).

Wire the trigger button to toggle panel visibility:

```ts
$('#btn-open-banking').addEventListener('click', () => {
  const panel = $('#open-banking-panel');
  panel.hidden = !panel.hidden;
});
```

- [ ] **Step 6: Run the component test to verify it passes**

Run: `npx vitest run tests/component/open-banking-panel.component.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full unit and component suites**

Run: `npm run test:unit && npm run test:component`
Expected: PASS

- [ ] **Step 8: Manual verification against Bank Hapoalim's actual sandbox**

With `OPEN_BANKING_SANDBOX=1`, a real `OPEN_BANKING_SOURCES` line for Hapoalim's sandbox, and sandbox client credentials from `poalimdev.co.il`, run the app locally end to end: click "Connect a bank" → complete the sandbox consent → land back on the app → "Sync now" → confirm real sandbox transactions appear and fold into the existing categorizer/settlement/card-summary logic correctly. **This is the step that confirms or corrects the Berlin Group field-name assumption in Task 7** — if Hapoalim's actual response shape differs, fix `server/open_banking_sync.py`'s `_to_row` mapping only; no other task should need to change.

- [ ] **Step 9: Commit**

```bash
git add fe/mazan-habait.html fe/src/app.ts fe/resources/he.json fe/resources/en.json fe/resources/am.json fe/resources/fr.json tests/component/open-banking-panel.component.test.ts
git commit -m "feat(open-banking): connect, list, sync and disconnect from the main screen"
```

---

### Task 13: OpenAPI contract for the new endpoints

**Files:**
- Modify: `fe/openapi.json`
- Modify: `tests/contract/openapi.contract.test.ts`

**Interfaces:**
- Consumes: the routes defined in Task 8
- Produces: contract assertions proving the open-banking paths are documented and correctly scoped

- [ ] **Step 1: Write the failing test**

Add to `tests/contract/openapi.contract.test.ts`:

```ts
it('documents the open-banking routes with the right authentication shape', () => {
  expect(spec.paths['/api/open-banking/sources'].get.security).toEqual([]);
  expect(spec.paths['/api/open-banking/connect/{sourceId}'].get.security).toEqual([]);
  for (const path of ['/api/open-banking/connections', '/api/open-banking/sync/{connectionId}', '/api/open-banking/connections/{connectionId}', '/api/consents/open-banking']) {
    for (const operation of Object.values(spec.paths[path]) as Array<{ security: unknown }>) {
      expect(operation.security).toEqual([{ bearerAuth: [] }]);
    }
  }
  expect(spec.components.schemas.Consent.properties.statementVersion.const === 'cloud-sync-v2-privacy-minimised-2026-08-24'
    || spec.components.schemas.OpenBankingConsent.properties.statementVersion.const).toBeTruthy();
});

it('never documents a response schema that includes token material', () => {
  const text = JSON.stringify(spec);
  expect(text).not.toMatch(/refresh[_-]?token/i);
  expect(text.toLowerCase()).not.toContain('encrypted_refresh_token');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/contract/openapi.contract.test.ts -t "open-banking"`
Expected: FAIL — `spec.paths['/api/open-banking/sources']` is `undefined`

- [ ] **Step 3: Add the paths and schemas to `fe/openapi.json`**

Open `fe/openapi.json`, find the `paths` object, and add entries for each new route following the exact shape the existing `/api/snapshots`/`/api/profile`/`/api/consents/cloud-sync` entries already use (`operationId`, `security`, `responses` with status codes matching `server/open_banking_routes.py`'s `_error(...)` calls). `/api/open-banking/sources` and `/api/open-banking/connect/{sourceId}` carry `"security": []` (no bearer token required to list sources or start a redirect); every other new path carries `"security": [{"bearerAuth": []}]`, matching `/api/profile`. Add response schemas for `OpenBankingSource`, `OpenBankingConnection`, and a `MappedTransaction` array, built the same way `PrivacySafeTransaction` is already built — no field named anything containing "token" anywhere in these schemas.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/contract/openapi.contract.test.ts`
Expected: PASS, including every previously-passing assertion in the file

- [ ] **Step 5: Regenerate the build copy**

Run: `npm run build:docs` (or whichever script `scripts/prepare-vercel-output.ts` is invoked by — check `package.json`'s `build:docs` script) so `public/openapi.json` picks up the change; do not hand-edit `public/openapi.json` directly.

- [ ] **Step 6: Run the complete test gate**

Run: `npm run test:gate`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add fe/openapi.json public/openapi.json tests/contract/openapi.contract.test.ts
git commit -m "docs(open-banking): document the new endpoints in the OpenAPI contract"
```

---

## Final Verification

- [ ] Run `pytest tests/server -v` — full server suite passes
- [ ] Run `npm run test:unit && npm run test:component` — full frontend unit/component suites pass
- [ ] Run `npm run test:gate` — the project's complete pre-merge gate passes
- [ ] Confirm `git grep -n "open-banking\|open_banking"` across `fe/src/privacy.ts`, `fe/src/state-repository.ts`, `server/models.py`, `fe/openapi.json` all agree on the same `src` value, per the Global Constraints lockstep rule
- [ ] Confirm `OPEN_BANKING_SANDBOX` unset and `OPEN_BANKING_LICENCE_ID` unset together mean `/api/open-banking/connect/*` always answers `open_banking_not_configured`, never a redirect
- [ ] Manual sandbox run against Bank Hapoalim completed (Task 12, Step 8) and any field-name corrections to `server/open_banking_sync.py` made and committed
