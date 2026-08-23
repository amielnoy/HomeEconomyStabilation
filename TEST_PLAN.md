# Test plan

## Objective and release gate

The test suite protects the local-first household-finance experience across correctness, localization, accessibility, mobile behavior, security, API contracts and operational infrastructure. A releasable commit must pass `npm run build` and `npm run test:all`. The reproducible local release gate is `npm run test:docker`, which also publishes the combined Allure report on localhost.

No test may use real banking credentials, production JWTs or personally identifying financial data. Browser tests use the checked-in synthetic workbook only. A skipped test is acceptable only when its scenario is intentionally inapplicable to that Playwright project; unexpected skips, flaky retries or missing report output require investigation.

## Environments and browser matrix

| Layer | Runtime | Purpose |
|---|---|---|
| Unit, API, contract | Vitest on Node | Fast logic, schema, security and public-boundary validation |
| Component | Vitest with JSDOM | Rendered controls, translations, disclosures and link behavior |
| Desktop browser | Playwright, Desktop Chrome | Primary journeys and keyboard/desktop behavior |
| Android browser | Playwright, Pixel 7 Chromium profile | Touch layout, responsive journeys and Android browser behavior |
| iOS browser | Playwright, iPhone 13 WebKit profile | WebKit, safe-area, touch and iOS browser behavior |
| Container release gate | Docker Compose | Tests the built web and API images over the internal service network |

Playwright device profiles are repeatable emulations, not a substitute for final manual checks on physical iOS and Android devices with VoiceOver and TalkBack.

## Commands and expected artifacts

| Command | Expected result |
|---|---|
| `npm run build` | Application and API TypeScript compile; local Swagger assets are copied |
| `npm test` | All Vitest unit, API, contract and component suites pass |
| `npm run test:e2e` | All applicable Playwright scenarios pass in three browser projects |
| `npm run test:all` | Vitest followed by Playwright |
| `npm run verify` | Build followed by the complete local suite |
| `npm run test:docker` | Compose services start, every test runs, and Allure is published at the printed localhost URL |
| `npm run test:docker:stop` | The isolated test and report stack stops without affecting the development stack |

Artifacts:

- `playwright-report/` — Playwright’s native HTML report, including `test.step` descriptions.
- `allure-results/` — raw Vitest and Playwright Allure events inside the Compose volume.
- `allure-report/` — generated combined report, served by the `allure` service.
- Retained Playwright traces are attached only for failures.

## Unit suites

| File | Coverage |
|---|---|
| `tests/unit/financial-agents.unit.test.ts` | Seven independent agents, safe-to-spend edge cases and month-end payday clamping |
| `tests/unit/localization.unit.test.ts` | Supported locale validation, RTL/LTR, UTC formatting and named parameters |
| `tests/unit/credit-card-importer.unit.test.ts` | Charges, refunds and invalid workbook rows |
| `tests/unit/marketing.unit.test.ts` | Allowed attribution, first/last touch and bounded local event history |
| `tests/unit/cloud-sync.unit.test.ts` | Snapshot validation, signed-out failure and authorization-header handling |
| `tests/unit/consent.unit.test.ts` | Versioned consent, malformed records and withdrawal |

## API suites

| File | Coverage |
|---|---|
| `tests/api/credit-card-importer.api.test.ts` | Stable importer output and unsupported workbook rejection |
| `tests/api/financial-agents.api.test.ts` | Stable result slot for every agent |
| `tests/api/localization.api.test.ts` | Public locale configuration and formatter factory |
| `tests/api/marketing.api.test.ts` | Stable attribution payload and callable analytics boundary |
| `tests/api/supabase-infrastructure.api.test.ts` | Shared HTTP statuses, configuration fail-closed behavior and bearer parsing |

## Contract and security suites

| File | Coverage |
|---|---|
| `tests/contract/design-system-contract.test.ts` | Tokens, focus, reduced motion, typography and directional drawers |
| `tests/contract/documentation-contract.test.ts` | README, architecture, design system, Supabase, TODO, monitoring and this test plan stay synchronized |
| `tests/contract/importer-contract.test.ts` | Dashboard transaction shape |
| `tests/contract/localization-contract.test.ts` | Key parity, named-parameter parity and complete HTML/runtime translation coverage |
| `tests/contract/monitoring.contract.test.ts` | Prometheus, Grafana and combined Allure publication |
| `tests/contract/openapi.contract.test.ts` | Snapshot operations, bearer security, responses and self-hosted Swagger |
| `tests/contract/security-sanity.contract.test.ts` | Dangerous sinks, HTTPS opener isolation, file types and remote scripts |
| `tests/contract/supabase-schema.contract.test.ts` | Tables, grants, RLS ownership and publishable-key boundary |
| `tests/contract/test-id-contract.test.ts` | Stable test IDs for static/dynamic controls and Page Object selector discipline |

## Component suites

| File | Coverage |
|---|---|
| `tests/component/cloud-consent.component.test.ts` | Unselected explicit consent, voluntariness, limits and rights |
| `tests/component/credit-card-upload.component.test.ts` | Multi-file spreadsheet upload contract |
| `tests/component/financial-agents.component.test.ts` | Accessible seven-agent host and prominent safe-to-spend result |
| `tests/component/language-picker.component.test.ts` | Native language names, accessible field and keyboard semantics |
| `tests/component/marketing-landing.component.test.ts` | Conversion path, concrete benefits, privacy and claim discipline |
| `tests/component/savings-directory.component.test.ts` | Official tools, Paamonim, Mekimi, commercial providers, safe links and neutral disclosure |

## End-to-end and sanity suites

| File | Coverage |
|---|---|
| `tests/e2e/accessibility.e2e.spec.ts` | axe WCAG A/AA checks for empty, populated, settings, agents and directory states |
| `tests/e2e/api-docs.e2e.spec.ts` | Self-hosted Swagger and all snapshot operations |
| `tests/e2e/architecture.e2e.spec.ts` | Architecture content, responsive layout and accessibility |
| `tests/e2e/cloud-consent.e2e.spec.ts` | Consent acceptance and withdrawal without upload |
| `tests/e2e/credit-card-upload.e2e.spec.ts` | Real workbook import, upload availability and prioritized recommendations |
| `tests/e2e/financial-agents.e2e.spec.ts` | Seven agents, safe-to-spend, explicit approvals and translation |
| `tests/e2e/i18n-dynamic.e2e.spec.ts` | Generated English, French and Amharic copy without Hebrew leakage |
| `tests/e2e/localization.e2e.spec.ts` | Persistence, RTL/LTR, ILS formatting and mobile overflow in every locale |
| `tests/e2e/marketing-landing.e2e.spec.ts` | Attribution privacy, CTAs, four locales and dark mode |
| `tests/e2e/mobile-usability.e2e.spec.ts` | Touch targets and complete Android/iOS browser journey |
| `tests/e2e/savings-directory.e2e.spec.ts` | Empty-state access, 15 links, support section, WhatsApp channel, French and return journey |
| `tests/e2e/security-sanity.e2e.spec.ts` | Workbook XSS, malformed backup, opener isolation and no outgoing financial writes |
| `tests/e2e/spending-guide.sanity.e2e.spec.ts` | Missing inputs and projected-shortfall fail-safe behavior |
| `tests/e2e/support-organizations.sanity.e2e.spec.ts` | Paamonim, Mekimi and WhatsApp URLs, neutral presentation, ordering and four-language copy |

## Manual checks before a material release

1. Open the application on a physical iPhone and Android device.
2. Complete bank and card import using synthetic data.
3. Switch Hebrew → Amharic → French → English and verify direction, wrapping and understandable copy.
4. Navigate using keyboard only, then check VoiceOver and TalkBack announcements.
5. Open Paamonim, Mekimi and the Paamonim WhatsApp channel; verify the destinations are still official HTTPS pages and that the channel has not become a private-advice promise.
6. Review Swagger without entering a production token.
7. Review Grafana and confirm no JWT, transaction, email or snapshot content appears in metrics.
8. Open the Allure report and investigate failures, retries, unexpected skips and missing attachments.

## Failure handling

- A build, test or report-generation failure makes `npm run test:docker` exit non-zero.
- The runner still attempts to generate and serve Allure after a test failure.
- Do not approve a deployment based only on a green dashboard; inspect unexpected retries and skips.
- Never solve a failing security, localization or accessibility test by weakening the assertion without documenting an intentional product decision.
