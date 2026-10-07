# Open Banking integration — design

## Purpose

Let a household connect a real bank account or credit card issuer to מאזן הבית and
pull transactions live, instead of importing a statement file by hand. This is the
foundation piece only: a generic client for the Bank of Israel's Open Banking standard,
proven end to end against one pilot source's sandbox. A second bank or a card issuer
after that is a configuration entry, not a new design.

## Regulatory context (why this ships dark by default)

Two separate regimes apply, and the design exists to keep them from being confused:

- **Supply side — Bank of Israel Directive 368 / Open Banking.** Obligates banks (and,
  per the `kind` field already sketched in `.env.example`, card issuers) to expose a
  standardised API: a Berlin Group NextGenPSD2-based XS2A profile, reached over mTLS,
  consent-gated, strong-customer-authentication at the bank's own login. This is the
  side the bank operates; it is the API this project becomes a client of.
- **Consumption side — חוק שירות מידע פיננסי, התשפ"ב-2021**, regulated by the Israel
  Securities Authority. Anyone who collects a customer's data from their financial
  institutions and provides a service on it needs a licence as a נותן שירות מידע
  פיננסי (licensed Financial Information Service Provider). Because this app could
  serve households other than its own operator, that licence requirement applies in
  full — this is not a personal-use exemption.

As of this design, that licence is **not held**. The deliverable is therefore the
complete integration, runnable only against each source's sandbox/test registry, with
every real (non-sandbox) call refused until `OPEN_BANKING_LICENCE_ID` is set. Setting
that variable states a licence is held; it does not grant one. Going live with a real
institution is a legal/business step (the licence, then that institution's own
production onboarding), not a code change.

## Pilot source

**Bank Hapoalim**, via its `poalimdev.co.il` developer portal. It documents the Bank of
Israel PSD2-style standard explicitly, offers a sandbox environment, and states plainly
that production calls require an Israeli PSD2/Financial-Information-Service licence —
which matches exactly where this project is. Later sources (other banks, card issuers
such as כאל) are added as additional `OPEN_BANKING_SOURCES` entries once this pilot
proves the flow; they do not need their own design.

## Scope

- **Read-only (AIS): account balances and transactions.** No payment initiation (PIS).
  A budgeting tool needs to see money move, not move it — this keeps the licence,
  consent language and security surface to what the feature actually requires.
- **On-demand sync only.** A household clicks "Sync now" on a connected account, the
  same mental model as today's manual statement import. No background scheduler, no
  unattended token refresh, no cron job in this iteration.
- **One pilot institution, sandbox only**, until the licence exists.

Out of scope for this design: payment initiation, scheduled/background sync, any
institution beyond the pilot, production credentials of any kind.

## Architecture

Approach taken: extend the existing FastAPI server (`server/`) and Supabase store,
rather than standing up a separate service. The pilot's data is no more sensitive than
what `cloud_sync` already handles, and a dedicated service's isolation benefit — keeping
regulated secrets blast-radius-separated from the rest of the app — only pays for itself
once there are several real, licensed institutions in production. Revisit the split at
that point.

### New modules

- `server/open_banking_flow.py` — the consent/OAuth round trip. Structurally mirrors
  `server/auth_flow.py`: a PKCE challenge, a short-lived state cookie, a redirect to the
  source's `authorization_url`, a callback that exchanges the code for tokens. Reuses
  `is_allowed_redirect`/`allowed_origins`-style checks so a crafted link cannot carry a
  connection to somewhere else.
- `server/open_banking_store.py` — the Supabase repository, following the shape of
  `UserProfileRepository`/`SnapshotRepository`/`ConsentRepository` in
  `server/supabase_store.py`: one class per concern, each scoped to `user_id`, each
  operation recorded through the existing `record_supabase_response` metrics path.
- `server/open_banking_sources.py` — parses `OPEN_BANKING_SOURCES` (`id|kind|name|
  base_url|authorization_url|token_url`) and `OPEN_BANKING_CLIENT_ID_<SOURCE>` the way
  `config.py` parses `SUPABASE_URL`: reject anything not `https`, drop a malformed line
  rather than guess at it.

### New routes on `server/app.py`

| Route | Method | Purpose |
|---|---|---|
| `/api/open-banking/sources` | GET | List configured sources and whether each is sandbox or production-gated |
| `/api/open-banking/connect/{source_id}` | GET | Start consent; redirect to the source's authorize URL |
| `/api/open-banking/callback` | GET | Exchange the code, store the connection |
| `/api/open-banking/connections` | GET | List this user's connections |
| `/api/open-banking/sync/{connection_id}` | POST | Pull fresh data, return mapped transactions |
| `/api/open-banking/connections/{connection_id}` | DELETE | Revoke |

Every route above `sources` requires an authenticated session (the existing Google
sign-in) and an active `open_banking` consent, exactly as `/api/snapshots` requires an
active `cloud_sync` consent today. `connect` and `sync` additionally go through
`SnapshotRequestGuard`'s rate limiting (a new `open_banking` bucket, same mechanism, own
counter).

## Consent

`ConsentAcceptance.purpose` (currently `Literal["cloud_sync"]` in `server/models.py`)
gains a second value: `Literal["cloud_sync", "open_banking"]`. The existing
`(user_id, purpose, statement_version)` primary key and merge-on-accept behaviour in
`ConsentRepository` need no change — `open_banking` is just a second purpose row,
following the exact same read/accept/withdraw shape.

The consent statement shown before `connect` states explicitly, in plain language:
this is read-only (no payments can be made from מאזן הבית), which institution is about
to be contacted, and that revoking the connection stops future syncs but does not
delete transactions already pulled (consistent with how deleting a manual import today
does not retroactively change history).

## Storage

Two new tables, both RLS-scoped to `user_id` like `app_snapshots`:

```sql
create table open_banking_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  source_id text not null,
  status text not null check (status in ('active', 'revoked')),
  consent_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table open_banking_tokens (
  connection_id uuid primary key references open_banking_connections(id) on delete cascade,
  encrypted_refresh_token text not null,
  updated_at timestamptz not null default now()
);
```

No account number, card number or similar identifier is stored in either table — the
connection is addressed by the server's own `connection_id`, never by anything the bank
issued that would identify the account outside this app.

### Token encryption

The refresh token is encrypted **in the FastAPI process**, before it is ever sent to
Supabase: `cryptography.fernet.Fernet`, keyed from `OPEN_BANKING_TOKEN_ENCRYPTION_KEY`
(a new required env var once any source is configured). It is decrypted only in memory,
only for the duration of a `sync` or token-refresh call, and never logged — the same
rule `PRIVACY.md` already states for card digits ("it never reaches a log line"). This
mirrors the existing pattern of building a sanitised object before persistence; the
difference is that here the sanitising/encrypting step runs server-side, because the
token itself must never reach the browser at all, not even redacted.

The access token (short-lived) is not persisted — each `sync` call refreshes it from the
stored refresh token and discards it afterward.

## Pulling and mapping data

A `sync` call:

1. Decrypts the connection's refresh token, exchanges it at the source's `token_url`.
2. Calls the source's XS2A accounts/transactions endpoints (sandbox base URL while
   unlicensed).
3. Maps each returned transaction into the existing `Transaction` Pydantic model /
   `BankTransaction` TypeScript type.

Mapping decisions:

- `source`: `'bank'` or `'card'`, read from the source's `kind` configuration value —
  the same field `transaction-view.ts`'s card-summary folding and `decorate()`'s
  settlement-neutralising already key off.
- `src`: a new `SnapshotSource` value, `'open-banking'`, added alongside the existing
  `'bank-report' | 'card-report' | 'manual-entry'`. Per the rule already stated in
  `PRIVACY.md`, this value must be added in lockstep in all four places a `src` value
  is known: the browser allowlist (`fe/src/privacy.ts`), the state codec, this Pydantic
  model, and the OpenAPI schema — a value known in only some of them is rejected at the
  first boundary that does not recognise it.
- `desc`, `ref`: pass through the same financial-identifier redaction
  (`_contains_financial_identifier` / its `fe/src/privacy.ts` mirror) already applied to
  every description before persistence.
- No account label, IBAN or card number from the XS2A response is ever written into any
  field — the existing allowlist DTO construction already drops these; mapping produces
  only allowlisted fields to begin with, so there is nothing for that boundary to catch
  here, but the boundary stays as the backstop it already is for every other source.

Once mapped, these rows are indistinguishable from an imported statement to every piece
of existing logic: the rule-based categorizer, `decorate()`'s card-settlement
neutralising, `settlementBills()`'s charge-matching, and the bank-with-card-totals
folding in `transaction-view.ts`. None of those need to change.

## Frontend

A "Connect a bank" entry point beside the existing "טעינת דוח בנק" / "טעינת דוח כרטיס"
upload buttons (same toolbar, same visual weight — connecting live is an alternative
import path, not a separate feature). Flow:

1. Shows configured sources from `/api/open-banking/sources`, each labelled sandbox or
   (once licensed) production.
2. "Connect" navigates the browser to `/api/open-banking/connect/{source_id}`, which
   redirects to the bank's own login/consent page — no credential of any kind is ever
   entered inside מאזן הבית itself, the same trust boundary Google sign-in already uses.
3. On return, the callback lands back in the app; `/api/open-banking/connections` lists
   connected accounts, each with "Sync now" and "Disconnect".
4. "Sync now" calls `/api/open-banking/sync/{connection_id}` and merges the returned
   transactions into `S.tx` the same way an imported report is merged today (same
   dedup-by-id behaviour already in place for repeated imports).

No new persistent browser storage: a connection's existence is read from the server on
load, not cached in `localStorage` — unlike the imported-statement path, this data has a
server-side source of truth the browser does not need to duplicate.

## Configuration and production gating

No change to the `.env.example` shape already sketched; this design implements it:

- `OPEN_BANKING_SANDBOX=1` — every configured source resolves to its test registry,
  returns invented accounts. Required for `connect` to run at all while unlicensed.
- `OPEN_BANKING_LICENCE_ID` — unset means every non-sandbox `connect` is refused with
  `open_banking_not_configured`. This is the single switch between "testable today" and
  "answers for a real household's real account" — it is deliberately not implied by any
  other setting, so turning it on is a specific, auditable act.
- `OPEN_BANKING_SOURCES`, `OPEN_BANKING_CLIENT_ID_<SOURCE>`, `OPEN_BANKING_CLIENT_CERT`,
  `OPEN_BANKING_CLIENT_KEY` — read and validated as already commented.
- `OPEN_BANKING_TOKEN_ENCRYPTION_KEY` — new. Required once any source is configured;
  startup fails closed (feature reports unconfigured) rather than storing an unencrypted
  token if it is absent.

## Error handling

- Source unreachable / token exchange fails mid-`connect`: the state cookie expires
  (same `STATE_TTL_SECONDS` pattern as Google sign-in) and the user is told to retry;
  nothing partial is written to `open_banking_connections`.
- `sync` fails (expired consent, revoked at the bank, network failure): the connection's
  `status` is left `active` (a transient failure is not a revocation) and the UI reports
  the failure without guessing at a cause it cannot verify.
- The bank reports consent expired or withdrawn: `status` moves to `revoked`,
  `encrypted_refresh_token` is deleted immediately rather than kept inert — a token that
  no longer works is not worth the risk of holding.
- A mapped transaction that fails the existing `Transaction` validation (e.g. a
  description the identifier-redaction boundary would otherwise have to strip) is
  dropped from that sync's result rather than failing the whole sync — one bad row costs
  the row, not the pull, matching the rule `PRIVACY.md` already states for the codec.

## Testing

- `tests/server` — Pytest for `open_banking_flow.py` (challenge/state/redirect
  validation, mirroring the existing `auth_flow` tests) and `open_banking_store.py`
  (RLS scoping, encryption round-trip: write then read never returns the plaintext
  refresh token).
- A fake XS2A server (fixture, not a real Hapoalim sandbox dependency in CI) exercises
  the pull → map → validate pipeline, including the identifier-redaction and dedup
  paths.
- `tests/unit` — mapping logic: `kind` → `source`, new `src` value accepted everywhere
  the other three are.
- `tests/security` (browser) — asserts no token, encrypted or otherwise, and no
  `open_banking_tokens` content ever reaches a network response the browser can read,
  the same style as the existing "local import produces no write request" sanity test.
- Manual verification against Bank Hapoalim's actual sandbox is the final check before
  calling the pilot done — invented sandbox accounts only, never production.

## Explicit non-goals (this iteration)

- Payment initiation.
- Scheduled/background sync or unattended token refresh.
- Any institution beyond the Bank Hapoalim pilot (adding one is a config entry once this
  ships, not a new design).
- Actually connecting to a real household's real account — gated on the ISA licence,
  which is a business/legal step outside this design's scope.
