# Privacy boundary

## What is and is not stored

Financial reports are parsed in memory and are never uploaded on the default local path. The original file bytes are not persisted. The browser keeps only the minimised transaction fields required for history, budgets and the financial agents.

Before browser storage, manual backup or optional cloud snapshot, the privacy boundary constructs a fresh allowlisted DTO rather than copying the imported object. It:

- removes detected bank-account labels;
- removes transaction references;
- replaces the original report filename with `bank-report`, `card-report` or `manual-entry`;
- redacts card-number-like values, bank-account-like values, IBAN and labelled CVV/CVC values from descriptions;
- rejects account collections and unsanitised transactions at the future cloud API boundary.
- rejects unknown transaction properties, including future fields that have not been explicitly approved for persistence.

The Python API repeats this boundary with Pydantic models that forbid unknown fields, bound collection and payload sizes, reject account/card/CVV-like identifiers, and use the authenticated user's JWT plus owner-only RLS. Neither the API, Prometheus nor Grafana receives a PostgreSQL password or service-role key.

Amounts, dates, merchant descriptions, balances, categories and approved rules remain financial data. They stay in the browser until the user chooses **Delete all**, clears site storage or imports a replacement backup. A manual backup is an explicit user-controlled JSON file and contains the same minimised snapshot. Cloud sync is inactive.

Older `mazan-habait/v1` browser state is sanitised and rewritten when loaded, removing previously persisted account labels, references and filenames.

## Regulatory interpretation

This is an engineering control, not a certification or legal opinion.

- GDPR does not prohibit all storage. It requires a lawful and transparent purpose, data minimisation, storage limitation, integrity/confidentiality and enforceable data-subject rights. The operator must still publish controller identity, lawful basis, retention periods, deletion/access channels, processor terms and geographic scope before production use. See the [European Commission’s GDPR principles](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en).
- HIPAA generally applies only to covered entities and business associates handling protected health information. A household-finance application is not automatically subject to HIPAA merely because some transactions concern health expenses. Applicability depends on the operator and its relationships. See [HHS: Covered Entities and Business Associates](https://www.hhs.gov/hipaa/for-professionals/covered-entities/index.html).

Do not claim “GDPR compliant”, “HIPAA compliant” or “no financial data is stored” without a fact-specific legal review. The accurate product claim is: raw reports and sensitive account/card identifiers are not persisted; minimised transaction history is stored locally for product functionality.

## Verification

The privacy and state-repository unit suites inject account, card, note and prototype-like properties and verify that the allowlist removes or rejects them. Cloud repository tests cover account collections, unknown properties, provider failure, timeout and deletion. Browser security sanity imports real-shaped bank and card data and inspects the actual `localStorage` value. Network sanity separately proves that local import produces no write request.

Pytest verifies the Python models, request guard, authenticated repository filters and stable error boundary. The complete mapping and commands are in [TEST_PLAN.md](TEST_PLAN.md).
