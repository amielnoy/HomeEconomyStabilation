# Test plan

## Objective and release gate

The test suite protects the local-first household-finance experience across correctness, privacy minimisation, localization, accessibility, mobile behavior, security, API contracts and operational infrastructure. A releasable commit must pass `npm run build` and `npm run test:all`. The reproducible local release gate is `npm run test:docker`, which also publishes the combined Allure report on localhost.

No test may use real banking credentials, production JWTs or personally identifying financial data. Browser tests use the checked-in synthetic workbook only. A skipped test is acceptable only when its scenario is intentionally inapplicable to that Playwright project; unexpected skips, flaky retries or missing report output require investigation.

## Environments and browser matrix

| Layer | Runtime | Purpose |
| --- | --- | --- |
| Unit, API, contract | Vitest on Node | Fast logic, schema, security and public-boundary validation |
| Python server | Pytest on Python 3.12 | FastAPI routes, validation, guards and Supabase repositories |
| Component | Vitest with JSDOM | Rendered controls, translations, disclosures and link behavior |
| HTTP API | Playwright request context | Real-server health, method, authentication-boundary and not-found behavior |
| Desktop browser | Playwright, Desktop Chrome | Primary journeys and keyboard/desktop behavior |
| Android browser | Playwright, Pixel 7 Chromium profile | Touch layout, responsive journeys and Android browser behavior |
| iOS browser | Playwright, iPhone 13 WebKit profile | WebKit, safe-area, touch and iOS browser behavior |
| Container release gate | Docker Compose | Tests the built web, API and dedicated Scalar server images over the internal service network |

Playwright device profiles are repeatable emulations, not a substitute for final manual checks on physical iOS and Android devices with VoiceOver and TalkBack.

## Commands and expected artifacts

| Command | Expected result |
| --- | --- |
| `npm run build` | TypeScript application/scripts compile, Python API validation and strict boundary typecheck pass, and local Swagger/Scalar assets are copied; project-owned JavaScript exists only as generated output |
| `npm run typecheck:strict` | New domain, import, persistence and API boundaries pass strict/null/index type checks |
| `npm test` | All Vitest unit, API, contract and component suites pass |
| `npm run test:server` | All Pytest server suites pass |
| `npm run test:e2e` | All applicable Playwright scenarios pass in one API and three browser projects |
| `npm run test:all` | Vitest, Pytest and Playwright start together, all complete, and any failure fails the command |
| `npm run verify` | Build followed by both test frameworks in parallel |
| `npm run hooks:install` | Points git at `.githooks`; also run from `npm install` through `prepare`, so a fresh clone gets the pre-push gate without reading about it |
| `git push` | The `.githooks/pre-push` hook refuses unresolved merge markers and runs `npm test` first — about three seconds, against three minutes of CI. `git push --no-verify` skips it |
| `npm run test:docker` | Compose services start, every test runs, and Allure is published at the printed localhost URL |
| `npm run test:docker:stop` | The isolated test and report stack stops without affecting the development stack |

Artifacts:

- `playwright-report/` — Playwright’s native HTML report, including `test.step` descriptions.
- `allure-results/` — raw Vitest, Pytest and Playwright Allure events inside the Compose volume.
- `allure-report/` — generated combined report, served by the `allure` service.
- Retained Playwright traces are attached only for failures.

The Docker gate starts by removing stale containers and orphans from the isolated `home-economy-tests` Compose project without deleting its volumes. This makes reruns safe after an interrupted container replacement; the Allure server is force-recreated after report generation.

The Playwright test image installs `python3-venv` before creating its isolated Python environment, while the web build stage installs Python only to validate the FastAPI source during the shared build. These dependencies are image-local; a host running the Docker gate needs Docker Compose v2, not a host Python environment.

The shared POSIX runner tracks all three child process IDs, waits for every exit code and stops them on interruption. Playwright uses its normal local worker count and two workers in CI; Vitest retains its file-level parallelism, while Pytest covers the Python boundary independently. Build and Allure generation remain ordering barriers.

## Unit suites

| File | Coverage |
| --- | --- |
| `tests/unit/spreadsheet-reader.unit.test.ts` | Legacy .xls, .xlsx, SpreadsheetML 2003, CSV and HTML-table reading: delimiters, quoting, CRLF, magic-byte dispatch, colspan/rowspan alignment, shared and inline strings, optional cell references, date serials and windows-1255 decoding |
| `tests/unit/financial-agents.unit.test.ts` | Eight agents, saving estimates, Strategy injection, safe-to-spend edges and date clamping |
| `tests/unit/logging.unit.test.ts` | Shared record shape, level filtering, bounded ring buffer, redaction of financial identifiers, refusal of structured values, console mirroring, JSON-lines output, runtime level resolution, dated daily copies, the midnight roll, retention pruning, archive ordering and storage exhaustion yielding the log rather than the state |
| `tests/unit/localization.unit.test.ts` | Supported locale validation, RTL/LTR, UTC formatting and named parameters |
| `tests/unit/credit-card-importer.unit.test.ts` | Charges, refunds, headings with the definite article, billed versus transaction amounts, metadata rows above the heading, multi-sheet cards, pending sheets and invalid workbook rows |
| `tests/unit/bank-importer.unit.test.ts` | Hebrew and English bank headers, account extraction, card-source signed amounts, recognising a card report by its columns rather than by the control it arrived through, transaction normalization and stable IDs |
| `tests/unit/categorization.unit.test.ts` | Transfer/maintenance classification, maintenance arriving staying income, unknown fallbacks, income and manual-override precedence, and a direction-scoped rule claiming only the side it names |
| `tests/unit/marketing.unit.test.ts` | Allowed attribution, first/last touch and bounded local event history |
| `tests/unit/privacy.unit.test.ts` | Identifier redaction, allowlisted snapshots and removal/rejection of unknown sensitive properties |
| `tests/unit/state-repository.unit.test.ts` | Runtime state validation, safe migration, default-rule merge, newly added default categories returning at their own position, card-issuer round trip, a saved rule keeping the direction it was written with, prototype-key refusal and persistence round-trip |
| `tests/unit/card-statements.unit.test.ts` | What is on each card: issuers kept apart with their totals, statement rows left out, an unnamed card gathered without joining a named one, each card printed newest first, money that came back counted without being subtracted, and nothing said about a household with no card report |
| `tests/unit/financial-plan.unit.test.ts` | Reading a month as income, fixed spending, variable spending and money set aside: income lines named by where the money came from, fixed decided by what already recurs, set-aside money counted as money that left, a category whose refunds exceeded its charges kept rather than dropped, every section adding up to its lines, an empty month inventing nothing and a month that overspent returning a negative surplus, a settled card bill kept out of what left and out of what is left over while a settlement nothing itemises still counts |
| `tests/unit/misread-rows.unit.test.ts` | Finding rows a card report left the wrong way round, and leaving real money alone: a salary, an allowance, a refund and a zero balance the bank did report, a row typed by hand, a card row, a row that already reads as spending and one carrying money on both sides |
| `tests/unit/savings-goals.unit.test.ts` | Goal progress and what it asks of a month: the share saved, the remainder spread over the months up to and including the target month, a reached goal asking nothing more, an oversaved goal stopping at full, a passed target month named rather than divided by, a target of zero or NaN never becoming a percentage or an infinite monthly figure, and the order goals are worked through in |
| `tests/unit/transaction-view.unit.test.ts` | Folding card charges into one line per issuer beside statement rows, each issuer kept apart, an unnamed card folded without joining a named one, refunds carried into the card they arrived on, the summary dated by its newest charge, statement order preserved, and charges itemised where no statement row stands beside them |
| `tests/unit/cloud-sync.unit.test.ts` | Privacy-safe schema-v2 validation, signed-out behavior, auth headers, failures, timeout and DELETE |
| `tests/unit/cloud-metadata.unit.test.ts` | Authenticated Supabase profile/consent reads and writes, response validation, safe auth headers and withdrawal |
| `tests/unit/consent.unit.test.ts` | Versioned consent, malformed records and withdrawal |

## Python server suites

| File | Coverage |
| --- | --- |
| `tests/server/test_config.py` | Environment validation and strict bearer-token parsing |
| `tests/server/test_models.py` | Pydantic allowlists, size bounds, financial-identifier rejection, the card issuer, a categorisation rule carrying the direction it reads end to end through a snapshot, and a savings goal crossing the boundary with its name checked, its shape refused when unknown and its absence accepted from a browser that never had one |

| `tests/server/test_metrics.py` | Bounded route/method/operation labels and rejection of raw path or identity data in Prometheus output |
| `tests/server/test_auth_flow.py` | Google sign-in primitives: the PKCE challenge as the hash of a verifier the browser never sees, unique verifiers and states per attempt, an authorize URL carrying the challenge but not the verifier, redirect targets limited to this deployment's origins, and a provider response accepted as a session only with both tokens and a bounded lifetime |
| `tests/server/test_logging_config.py` | JSON-lines records in the shared shape, level names matching the browser, level filtering, handlers not stacking on reconfiguration, bounded route names, exceptions recorded by type without a traceback, every request logged with bounded metadata, a dated backup per day anchored to UTC, retention limits and their refusal of misconfiguration, the size cap surviving repeated same-day rollovers and pruning of the numbered copies |
| `tests/server/test_request_guard.py` | Media type, body size and bounded rate limiting |
| `tests/server/test_repositories.py` | Profile, snapshot and consent CRUD with owner filters and stable failures |
| `tests/server/test_app.py` | FastAPI health, methods, profile/consent persistence, authentication boundary, consent-gated snapshot writes, and the Google sign-in routes: refusal without cloud configuration, a callback that rejects a round trip it did not start, an httpOnly verifier absent from the redirect, no open redirect through `next`, and sign-out clearing only this device |

## API suites

| File | Coverage |
| --- | --- |
| `tests/api/spreadsheet-reader.api.test.ts` | The reader facade: one workbook shape from every container, dispatch on content rather than file name, thrown errors for unreadable bytes and sheet naming |
| `tests/api/credit-card-importer.api.test.ts` | Stable importer output, heading description for unsupported layouts, caller-workbook immutability and unsupported workbook rejection |
| `tests/api/financial-agents.api.test.ts` | Stable result slot for every agent |
| `tests/api/localization.api.test.ts` | Public locale configuration and formatter factory |
| `tests/api/marketing.api.test.ts` | Stable attribution payload and callable analytics boundary |

## Integration suites

| File | Coverage |
| --- | --- |
| `tests/integration/import-pipeline.integration.test.ts` | Raw report bytes through the reader into the importers for CSV, SpreadsheetML, HTML-as-.xls, .xlsx and the legacy .xls fixture, plus statement and card exports from one container shape, each source's sign convention, account attribution, a shared row shape across both uploads, a compressed multi-block export whose table starts low, the statement fallback for the card control, windows-1255 merchant names, .xlsx without cell references, SpreadsheetML calendar days, heading description for unreadable layouts and repeat-import ID stability |
| `tests/integration/locale-rendering.integration.test.ts` | Markup, resource files and the localization module applied to each other: every translated node filled, no key left showing, direction pairing, import-failure parameter substitution and rendered header label lengths |

## Contract and security suites

| File | Coverage |
| --- | --- |
| `tests/contract/git-hooks.contract.test.ts` | The pre-push gate's wiring: both scripts staying executable, the hooks path installed from `npm install` rather than from a paragraph in a readme, a checkout that is not a git repository left alone, and the hook running the Vitest gate, refusing merge markers and naming its own escape hatch |
| `tests/contract/design-system-contract.test.ts` | Semantic tokens, recipe ownership, variants, disabled/focus states, contrast preferences, touch targets, the card summary line's focus ring and touch target, typography and directional drawers, and a button the code has hidden actually leaving the screen |
| `tests/contract/discovery.contract.test.ts` | Assistant-crawler allowlist, canonical URL and duplicate suppression, sitemap and llms.txt link resolution, structured-data graph integrity, IndexNow key ownership, variable-font face declarations and deployment of every discovery file |
| `tests/contract/documentation-contract.test.ts` | README, architecture, design system, privacy, Supabase, TODO, monitoring and this test plan stay synchronized |
| `tests/contract/default-rules.contract.test.ts` | No default rule left unreachable behind an earlier rule of another category, no exact duplicates, and the national-insurance allowance filed as income rather than as an insurance expense |
| `tests/contract/control-labels.contract.test.ts` | Header action labels present, distinguishable and short enough to fit in every locale, and every data-i18n and translated aria-label key resolving |
| `tests/contract/importer-contract.test.ts` | Dashboard transaction shape, dense rows and legal cell typing from every reader, stable and distinct transaction IDs, and resolvable import messages |
| `tests/contract/responsive-layout.contract.test.ts` | Narrow-width header rules declared after the wider rules they override, shrinkable grid tracks, constrained overflow for nowrap actions, wrapping instead of truncation at the narrowest width, no pinned control widths and pinned text sizing |
| `tests/contract/logging-contract.test.ts` | Browser and API agreeing on record fields, level names, origin field, one-line records, bounded retention on both sides and runtime level configuration |
| `tests/contract/localization-contract.test.ts` | Key parity, named-parameter parity, complete HTML/runtime translation coverage, the listed advisor's role and non-endorsement disclaimer surviving in every language, and the page's Hebrew copy staying identical to the Hebrew resource |
| `tests/contract/monitoring.contract.test.ts` | Prometheus, bounded route labels, application/database Grafana dashboards, profile/consent/snapshot panels, privacy-safe Supabase metrics and combined Allure publication |
| `tests/contract/openapi.contract.test.ts` | Snapshot, profile and consent operations, privacy-minimised schema v2, bearer security, responses and self-hosted Swagger/Scalar |
| `tests/contract/security-sanity.contract.test.ts` | Dangerous sinks, HTTPS opener isolation, file types and remote scripts |
| `tests/contract/supabase-schema.contract.test.ts` | Tables, grants, RLS ownership, publishable-key boundary and migration/runtime schema-version parity |
| `tests/security/import-safety.security.test.ts` | Imported reports as untrusted input: external-entity refusal, prototype-pollution resistance, markup kept as text, clamped spans, refusal of truncated archives, rejection of unreadable amounts and a network-free import |
| `tests/security/localization-safety.security.test.ts` | Translations as authored input: no markup or executable URLs, no prototype-polluting resource keys and no re-expansion of a placeholder arriving inside a parameter |
| `tests/contract/test-id-contract.test.ts` | Stable test IDs for static/dynamic controls and Page Object selector discipline |
| `tests/contract/typescript-source.contract.test.ts` | No project-owned JavaScript source or inline scripts; browser behavior comes from compiled TypeScript modules |

## Component suites

| File | Coverage |
| --- | --- |
| `tests/component/cloud-consent.component.test.ts` | Unselected explicit consent, voluntariness, limits and rights |
| `tests/component/credit-card-upload.component.test.ts` | Multi-file spreadsheet upload contract |
| `tests/component/financial-agents.component.test.ts` | Accessible eight-agent host and prominent safe-to-spend result |
| `tests/component/language-picker.component.test.ts` | Native language names, accessible field and keyboard semantics |
| `tests/component/marketing-landing.component.test.ts` | Conversion path, concrete benefits, privacy and claim discipline |
| `tests/component/savings-directory.component.test.ts` | Official tools and adviser registries, independence checks, the requested advisor listing carrying its role and its not-an-endorsement notice, Paamonim, Mekimi, commercial providers and safe links |
| `tests/component/settings-drawer.component.test.ts` | Modal semantics, initial inert state and four collapsible settings groups |

## End-to-end and sanity suites

| File | Coverage |
| --- | --- |
| `tests/e2e/accessibility.e2e.spec.ts` | axe WCAG A/AA checks for empty, populated, settings, agents and directory states |
| `tests/e2e/chart-accessibility.e2e.spec.ts` | Both charts publish their figures as data tables, with row headers and the projection range |
| `tests/e2e/api-docs.e2e.spec.ts` | Self-hosted Swagger and Scalar loading the same specification and every health, snapshot, profile and consent operation |
| `tests/e2e/architecture.e2e.spec.ts` | Architecture content, responsive layout and accessibility |
| `tests/e2e/cloud-consent.e2e.spec.ts` | Consent acceptance and withdrawal without upload |
| `tests/e2e/cloud-metadata.sanity.api.e2e.spec.ts` | Anonymous profile/consent refusal, malformed metadata rejection, no-store responses and stable method contracts |
| `tests/e2e/card-source.e2e.spec.ts` | The card-source chooser: asking before the file dialog, importing once a card is chosen, dismissal and Escape importing nothing and returning focus, card spending counted once under either issuer answer, the issuer recorded in the log and remembered across a reload, and a dismissal not replaying the previous answer |

| `tests/e2e/credit-card-upload.e2e.spec.ts` | Real workbook import across CSV, SpreadsheetML, .xlsx with and without cell references, windows-1255 encoding and English column names, multi-file imports, localized unrecognised-layout reporting, duplicate re-imports, header labels after import, evidence-based transfer/maintenance categorization, leisure, studies, clothing, taxes, Jewish life, giving, computing and maintenance each separated from the bills, salary, shops, transfers, restaurants and streaming they arrive beside, every added category offered in every language, honest unknown fallback, upload availability and recommendations |
| `tests/e2e/statement-categorisation.e2e.spec.ts` | Merchant names from a real statement that the defaults filed as other or filed wrongly: both spellings of a municipality, a computer chain named in Hebrew, clothing, a charity, an optician, a city bus operator, a falafel stand and a payment app |
| `tests/e2e/transaction-source.e2e.spec.ts` | Every row naming where its figure came from: the bank on statement rows, the issuer the customer chose on card rows, a card whose issuer was not named saying only that, the answer surviving a reload, an issuer not carrying over to a later import, and the column offered in every language |
| `tests/e2e/quick-add.e2e.spec.ts` | Recording a cash expense from the button on the screen, the chosen category outranking the rule that would have claimed the description, the dialog opening on the amount with today filled in, only categories money can leave through being offered, a dismissed dialog adding nothing, the same expense refused a second time, an amount that is not money refused, and the path offered in every language |
| `tests/e2e/savings-goals.e2e.spec.ts` | Adding a goal and reading what it still needs and what that asks of a month, a reached goal marked rather than asked for more, an oversaved goal stopping at full, open goals worked through before reached ones, a goal surviving a reload, removal, an account number typed into a goal name not being kept, and the section offered in every language, and the screen itself: hiding the dashboard while open and giving it back, opening with nothing imported, returning to the goals after a reload, and closing when another screen is opened |
| `tests/e2e/financial-plan.e2e.spec.ts` | The month read as income, fixed spending, variable spending and money set aside; income lines named by where the money came from; a charge becoming fixed only once the same business stood in an earlier month; set-aside money counted against what is left; a shortfall named rather than shown as a negative surplus; income compared against spending in a figure that names both; and the plan offered in every language; a settled card bill left out of the month it already counted and shown on its own; a card bill nothing itemises still counted; and an empty spending section headed with a plain zero |

| `tests/e2e/screen-navigation.e2e.spec.ts` | Every screen named without opening a menu, the screen the reader is on marked and only that one, moving between screens and back to the dashboard, the bar staying one line on a phone without pushing the page sideways, and the screens offered in every language |
| `tests/e2e/card-statements.e2e.spec.ts` | The credit-cards screen: every charge listed with the number of cards it came from, one card at a time when chosen from the combo box, the cards named and sorted with every card first, each card printed newest first, every charge written as a red minus, an honest message with no card report imported, the dashboard hidden and given back, and the screen offered in every language |
| `tests/e2e/card-summary-view.e2e.spec.ts` | The transactions table opening on statement rows with each card folded to the sum it charged, opening a card onto the charges behind it, itemising every charge on request, a card report without a statement staying itemised, the count and totals reading the same in both views, and a folded card filed as a credit-card bill whichever issuer it came from while its charges keep their own categories |
| `tests/e2e/money-direction.e2e.spec.ts` | A row's dot carrying the direction of its money rather than the category's chart slot, a charge written as a red minus and money arriving as a green plus, the recurring-charges table coloured by direction rather than in one ink, and every figure in the spending breakdown and its table written as a red charge |
| `tests/e2e/repair-misread-rows.e2e.spec.ts` | The offer to correct rows read the wrong way round shown where the household is looking at them, the money turned round and each row filed by what it is, the offer asking twice and going away once taken, the correction surviving a reload, nothing offered to a household read correctly, and a chosen category carried across |
| `tests/e2e/reimport-correction.e2e.spec.ts` | A row saved the wrong way round being replaced rather than duplicated when the file is read correctly, the count of corrected rows said out loud, a category the customer chose carried across to the row that replaces it, and a refund the statement itself reported left alone |
| `tests/e2e/report-reader.e2e.spec.ts` | A card report chosen through the statement control being read by its columns and filed as spending rather than as income, the message naming which reader read it, and a statement staying with the statement reader |
| `tests/e2e/card-reconciliation.e2e.spec.ts` | A card settlement and its itemised card lines are counted once, not twice |
| `tests/e2e/financial-agents.e2e.spec.ts` | Eight agents, saving evidence, safe-to-spend, explicit approvals and translation |
| `tests/e2e/i18n-dynamic.e2e.spec.ts` | Generated English, French and Amharic copy without Hebrew leakage |
| `tests/e2e/localization.e2e.spec.ts` | Persistence, RTL/LTR, ILS formatting and mobile overflow in every locale |
| `tests/e2e/marketing-landing.e2e.spec.ts` | Attribution privacy, CTA visual hierarchy and tap size, four locales and dark mode |
| `tests/e2e/session-continuity.sanity.e2e.spec.ts` | Drag-and-drop import and its failure message, the month, a corrected category, a saved rule and a budget ceiling all surviving a reopen, a rule recategorising on the spot, the toast clearing itself, returning from recommendations and the dashboard rendering in dark mode |
| `tests/e2e/dashboard-controls.sanity.e2e.spec.ts` | The controls a household uses every visit: search narrowing and restoring the table, an empty search result, the category and direction filters, month-versus-history scope, month chips changing the rows with exactly one selected, the forecast horizon redrawing, the category chart/table toggle and filters leaving the month totals alone |
| `tests/e2e/settings-data.e2e.spec.ts` | The data section of the settings drawer: a backup round trip through the real codec after a delete, the clipboard export carrying a minimised copy, delete-all arming before it acts, deleting from storage as well as the screen, nothing-to-delete on an empty session and a typed transaction reaching its month with its chosen category |
| `tests/e2e/dual-upload.e2e.spec.ts` | Both uploads together: the two reports shown as one list, order independence, duplicate re-imports of each adding nothing, the bank account surviving a card import, an unreadable file costing only itself and both sources recorded in the log |
| `tests/e2e/logging.e2e.spec.ts` | The running application's log: the whole import path recorded, detected format and shape, rejection reasons, every customer command, no statement contents or file names in either the buffer or the dated copy, bounded buffer, level raised from the query string and a dated copy surviving a reload |
| `tests/e2e/mobile-usability.e2e.spec.ts` | Touch targets, whole upload labels at a zoom-narrowed viewport and complete Android/iOS browser journey |
| `tests/e2e/responsive-header.e2e.spec.ts` | The header across the zoom-narrowed width band, swept every 10px in all four languages: no overflow or cut labels at six widths, stacking only when the labels stop fitting, tappable and keyboard-reachable uploads, focus ring on the pill, overflow menu and failure message inside the viewport, WCAG reflow width and import from the stacked header |
| `tests/e2e/api-contract.sanity.api.e2e.spec.ts` | The operational and guard surface: container health, Prometheus exposition with HELP/TYPE pairing and bounded labels, a read-only metrics endpoint, refusal of oversized and non-JSON snapshot writes, format refused before the caller is considered, malformed bearer tokens never accepted, no-store on every response and one bare-code failure shape |
| `tests/e2e/http-api.api.e2e.spec.ts` | Real HTTP health GET/HEAD, method/media rejection, anonymous snapshot protection and unknown routes |
| `tests/e2e/savings-directory.e2e.spec.ts` | Empty-state access, 18 links, licensed-adviser registries, requested Dorit Gov Ari profile, support section, WhatsApp channel, French and return journey |
| `tests/e2e/savings-opportunities.sanity.e2e.spec.ts` | Annual/one-time separation, evidence disclosure and absence of automatic cancellation |
| `tests/e2e/security-sanity.e2e.spec.ts` | Workbook XSS, malformed backup, opener isolation, no outgoing financial writes and real-browser bank/card identifier minimisation |
| `tests/e2e/spending-guide.sanity.e2e.spec.ts` | Missing inputs and projected-shortfall fail-safe behavior |
| `tests/e2e/support-organizations.sanity.e2e.spec.ts` | Paamonim, Mekimi and WhatsApp URLs, neutral presentation, ordering and four-language copy |

## Manual checks before a material release

1. Open the application on a physical iPhone and Android device.
2. Complete bank and card import using synthetic data.
3. Switch Hebrew → Amharic → French → English and verify direction, wrapping and understandable copy.
4. Navigate using keyboard only, then check VoiceOver and TalkBack announcements.
5. Open Paamonim, Mekimi and the Paamonim WhatsApp channel; verify the destinations are still official HTTPS pages and that the channel has not become a private-advice promise.
6. Review Swagger and Scalar, including profile and consent operations and the snapshot consent prerequisite, without entering a production token.
7. Review Grafana and confirm no JWT, transaction, email or snapshot content appears in metrics.
8. Open the Allure report and investigate failures, retries, unexpected skips and missing attachments.
9. In a disposable Supabase project, apply every migration; with two synthetic users verify profile and consent isolation, refusal before consent, schema-v2 snapshot write/read/delete after consent, withdrawal, and controlled handling of a legacy-v1 row.

## Failure handling

- A build, test or report-generation failure makes `npm run test:docker` exit non-zero.
- The runner still attempts to generate and serve Allure after a test failure.
- Do not approve a deployment based only on a green dashboard; inspect unexpected retries and skips.
- Never solve a failing security, localization or accessibility test by weakening the assertion without documenting an intentional product decision.
