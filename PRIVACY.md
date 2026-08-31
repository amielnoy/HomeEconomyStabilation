# Privacy boundary

## What is and is not stored

Financial reports are parsed in memory and are never uploaded on the default local path. The original file bytes are not persisted. The browser keeps only the minimised transaction fields required for history, budgets and the financial agents.

Before browser storage, manual backup or optional cloud snapshot, the privacy boundary constructs a fresh allowlisted DTO rather than copying the imported object. It:

- removes detected bank-account labels;
- removes transaction references;
- replaces the original report filename with `bank-report`, `card-report` or `manual-entry`;
- redacts card-number-like values, bank-account-like values, IBAN and labelled CVV/CVC values from descriptions;
- rejects account collections and unsanitised transactions at the cloud API boundary.
- rejects unknown transaction properties, including future fields that have not been explicitly approved for persistence.

One field has been approved since: `cardKind`, which records whether a card was issued by the bank or outside it. It is a two-value enum chosen by the user rather than read from the file, it names no issuer, card or account, and it is stored as provenance so the question is not asked again after a reload. It does not enter the reconciliation calculation. Approving it meant naming it in the browser allowlist, the state codec, the Pydantic model and the OpenAPI schema; a field added to only some of those is rejected at the first boundary that does not know it — and because the codec rejects a whole transaction that carries a key it does not recognise, that rejection costs the row, not the field.

The Python API repeats this boundary with Pydantic models that forbid unknown fields, bound collection and payload sizes, reject account/card/CVV-like identifiers, and use the authenticated user's JWT plus owner-only RLS. Neither the API, Prometheus nor Grafana receives a PostgreSQL password or service-role key.

Amounts, dates, merchant descriptions, balances, categories and approved rules remain financial data. On the default path they stay in the browser until the user chooses **Delete all**, clears site storage or imports a replacement backup. A manual backup is an explicit user-controlled JSON file and contains the same minimised snapshot. Cloud sync remains inactive in the UI. The authenticated API can store a preferred locale and a versioned consent record; it accepts a minimised financial snapshot only after the current consent statement is active, and exposes explicit snapshot and consent deletion endpoints.

Older `mazan-habait/v1` browser state is sanitised and rewritten when loaded, removing previously persisted account labels, references and filenames.

## Signing in

Signing in with Google establishes a session and nothing else. The exchange happens on the
API rather than in the page: the browser is served under `connect-src 'self'` and is never
given a Supabase credential, so it cannot reach the provider directly and does not hold one
to lose. The flow is PKCE, so the verifier stays server-side for the length of the round
trip and an intercepted code is worthless; no token is written into a URL the browser keeps
in its history.

The session lives in an `httpOnly`, `Secure`, `SameSite=lax` cookie and is never readable by
JavaScript. The page builds no markup from data and runs under a strict CSP, but a token
readable by script is one mistake away from being an account rather than a request. Its
lifetime is bounded whatever the provider claims. Signing out clears that cookie and nothing
else — no data stored for the account is touched, and no data already on the device is
removed.

Signing in does not upload anything. Financial data still crosses to the account only after
the versioned consent statement is accepted, exactly as it does today, and what crosses is
still the minimised snapshot described above. An account owns its own budget: every table is
keyed to `auth.users` with owner-only RLS, so one signed-in customer cannot read another's
rows.

## Regulatory interpretation

This is an engineering control, not a certification or legal opinion.

- GDPR does not prohibit all storage. It requires a lawful and transparent purpose, data minimisation, storage limitation, integrity/confidentiality and enforceable data-subject rights. The operator must still publish controller identity, lawful basis, retention periods, deletion/access channels, processor terms and geographic scope before production use. See the [European Commission’s GDPR principles](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en).
- HIPAA generally applies only to covered entities and business associates handling protected health information. A household-finance application is not automatically subject to HIPAA merely because some transactions concern health expenses. Applicability depends on the operator and its relationships. See [HHS: Covered Entities and Business Associates](https://www.hhs.gov/hipaa/for-professionals/covered-entities/index.html).

Do not claim “GDPR compliant”, “HIPAA compliant” or “no financial data is stored” without a fact-specific legal review. The accurate product claim is: raw reports and sensitive account/card identifiers are not persisted; minimised transaction history is stored locally for product functionality and can be stored in the optional authenticated cloud snapshot only after active versioned consent.

## Verification

The privacy and state-repository unit suites inject account, card, note and prototype-like properties and verify that the allowlist removes or rejects them. Cloud repository tests cover account collections, unknown properties, profile/consent response validation, provider failure, timeout and deletion. Server route tests prove that a snapshot write is refused until the current consent statement is stored and active. Browser security sanity imports real-shaped bank and card data and inspects the actual `localStorage` value. Network sanity separately proves that local import produces no write request.

Pytest verifies the Python models, request guard, authenticated repository filters and stable error boundary. The complete mapping and commands are in [TEST_PLAN.md](TEST_PLAN.md).
