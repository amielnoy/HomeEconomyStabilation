---
name: home-economy-tests
description: Write, extend, run or debug tests in the Home Economy (מאזן הבית) repository — Vitest unit/api/contract/component/integration/security suites, Pytest server suites, and Playwright browser and API journeys with Page Objects. Use when adding a feature or fix that needs coverage, when a suite fails, or when asked which tests to run before calling work done.
---

# Home Economy tests

Three frameworks, run in parallel by `npm run test:all`: **Vitest** (browser logic and
contracts), **Pytest** (FastAPI server), **Playwright** (real browser and real HTTP).
`TEST_PLAN.md` is the map of every suite — read the section for the layer you are touching
before writing.

## 1. Pick the layer

Test at the lowest layer that can observe the behaviour; add a browser test only when the
behaviour is something a customer sees or does.

| What changed | Layer | Location and name |
| --- | --- | --- |
| Pure logic in `src/` (categorizer, agents, importers, codec, privacy) | Unit | `tests/unit/<module>.unit.test.ts` |
| A module's public shape / facade stays stable | API | `tests/api/<module>.api.test.ts` |
| Several modules applied to each other (bytes → reader → importer) | Integration | `tests/integration/<topic>.integration.test.ts` |
| An invariant read from source, markup, resources or docs | Contract | `tests/contract/<topic>.contract.test.ts` |
| Untrusted input (workbooks, translations, backups) | Security | `tests/security/<topic>.security.test.ts` |
| Static markup in `mazan-habait.html` (roles, aria, sections) | Component | `tests/component/<area>.component.test.ts` (JSDOM) |
| FastAPI routes, Pydantic models, guards, repositories | Server | `tests/server/test_<module>.py` |
| A customer journey in the page | E2E | `tests/e2e/<journey>.e2e.spec.ts` |
| A must-never-break journey | Sanity | `tests/e2e/<journey>.sanity.e2e.spec.ts` |
| Real HTTP against the API | API E2E | `tests/e2e/<topic>.api.e2e.spec.ts` (runs only in the `api` project) |

A categorisation change usually needs **both** a unit/contract assertion and one E2E upload
that shows the category in the transaction table.

## 2. Non-negotiable rules

- **Synthetic data only.** No real credentials, JWTs, account/card numbers, account holders
  or counterparties. A regression taken from a real statement keeps **business names only**.
  Browser tests use the checked-in `home_economy.xls` or an inline CSV built in the spec.
- **No network to real services.** Server suites use fakes/monkeypatch and the sandbox
  source; browser suites answer the API themselves (route interception) when the point is
  what the customer is shown.
- **Every new test file gets a row in `TEST_PLAN.md`** under its layer's table, formatted
  ``| `tests/…/file.ts` | Coverage as a comma-separated list of behaviours |``.
  `documentation-contract.test.ts` fails otherwise. Extending an existing suite means
  extending its row's coverage text.
- **Never weaken a security, privacy, localisation or accessibility assertion** to get green.
  Fix the product, or record the intentional decision in the test's comment and the docs.
- **No `.js` test files.** Everything is TypeScript (or Python for `tests/server`).
- Explain *why* in a block comment above a non-obvious test — the bug it pins, the collision
  it prevents. Match the existing tone; test names read as sentences about the household
  (`'separates computing from the connectivity and streaming it arrives beside'`).

## 3. Writing each layer

### Vitest (unit, api, integration, contract, security)

```ts
import { describe, expect, it } from 'vitest';
import { RuleBasedTransactionCategorizer } from '../../src/categorization';
import type { BankTransaction } from '../../src/domain-model';
```

- Import from `src/` directly; build fixtures with small factory functions at the top of the
  file. Use `it.each` for tables of inputs.
- Workbook bytes (`.xlsx` zips, SpreadsheetML, HTML-as-.xls): use the builders in
  `tests/helpers/workbook-fixtures.ts` instead of checking in binaries.
- Contract tests read files with `readFileSync(resolve(__dirname, '../..', file))` and
  assert on source/markup/resources. Give failures a message that names the offender:
  `expect(missing, 'offending rules').toEqual([])` beats a boolean.

### Component (JSDOM)

Load the real page and query by `data-testid`:

```ts
const document = new JSDOM(readFileSync(resolve(__dirname, '../../mazan-habait.html'), 'utf8')).window.document;
const drawer = document.querySelector<HTMLElement>('[data-testid="drawer"]')!;
```

### Pytest (server)

- `client = TestClient(app)` from `server.app`; `monkeypatch.delenv/setenv` for
  `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`; fake repository/auth classes instead of Supabase.
- Assert the exact status **and** the bare error body (`{"code": "cloud_not_configured"}`)
  and `cache-control: no-store` where the route promises it.
- Type-annotate tests `-> None`; a one-line docstring when the reason isn't obvious.

### Playwright (browser and API)

```ts
import { expect, test } from './fixtures';

test.beforeEach(async ({ homePage }) => { await homePage.openFresh(); });

test('files a municipality charge as a household bill', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'bank.csv', mimeType: 'text/csv', buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,יתרה',
      '03/09/2026,עירית חיפה,640,9000',
    ].join('\n')),
  });
  const categoryOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).getByTestId('transaction-category-select');
  await expect(categoryOf('עירית')).toHaveValue('home');
});
```

- Always import `test`/`expect` from `./fixtures`, never from `@playwright/test`. Specs never
  `new` a Page Object — they receive `homePage`, `architecturePage`, `homeEconomyApi`, etc.
- Start from a clean state with `homePage.openFresh()` (clears `localStorage`).
- Drive the real path: card reports go through `upload.uploadCreditCardReport(file, issuer,
  brand)`, which clicks the chooser before the file dialog.
- API specs use `homeEconomyApi` and `HttpStatus` from `src/http-status` rather than bare numbers.
- Web-first assertions only (`await expect(locator).toHaveValue(...)`); no fixed sleeps.

**Adding to the Page Object Model** (`tests/e2e/page-objects/`):

- Locators are `readonly` fields built with `this.page.getByTestId('…')` only —
  `test-id-contract.test.ts` rejects `page.locator(` in Page Objects.
- Every action method is `async` and decorated `@step('Plain-language description')`
  (from `./step` or `../step`), so it appears in the Playwright and Allure reports.
- A new component class goes in `components/`, is registered in `tests/e2e/fixtures.ts`, and
  — if it lives on the main page — added to `HomePageComponents` in `home.page.ts`.
- New UI needs a semantic `data-testid` on every interactive element and named region; a
  dynamic collection also needs its id listed in `test-id-contract.test.ts`. Never rename an
  existing test id.
- Shared checks already exist on `BasePage`: `hasHorizontalOverflow()`,
  `undersizedTouchTargets()`, `touchTargetsBelow()`, `useMobileViewport()`.

## 4. Running

```bash
npx vitest run --environment jsdom tests/unit/categorization.unit.test.ts   # one Vitest file
npx vitest run --environment jsdom tests/contract                           # a whole layer
python3 -m pytest -q -p no:playwright tests/server/test_app.py -k health    # one Pytest test
npx playwright test tests/e2e/credit-card-upload.e2e.spec.ts --project=desktop-chromium
npx playwright test -g "computing" --project=desktop-chromium               # by title
```

- **Always pass `--environment jsdom` to Vitest.** Without it the importer contract tests fail
  for lack of DOM APIs — a false regression.
- Playwright starts its own static server (:8765) and Uvicorn (:8766) and reuses running ones.
  **Browser specs load compiled `dist/`**, so run `npm run build` (or keep `npm run debug`
  running) after changing `src/` before a Playwright run — otherwise you test stale code.
- Projects: `desktop-chromium`, `android-chrome` (Pixel 7), `ios-webkit` (iPhone 13),
  `android-landscape` (mobile-usability only), `api` (`*.api.e2e.spec.ts` only).
- `npm run test:gate` is what CI blocks on (Vitest + Pytest + desktop-chromium + api).
  `npm run test:all` adds the mobile projects; the nightly sanity workflow runs it.

**Before calling work done:** `npm run build`, `npm test`, `npm run test:server` if `server/`
changed, and the affected Playwright specs on `desktop-chromium` — plus `android-chrome` and
`ios-webkit` for anything visual, layout, touch or mobile.

## 5. When a test fails

1. Read the assertion message first; contract tests name the offending file, key or rule.
2. Playwright: `npx playwright show-report` (or `npm run test:e2e:report`) — failures keep a
   trace with DOM snapshots and the `@step` timeline.
3. Decide whether the test or the product is wrong. A contract test exists because a real
   defect once shipped; the usual fix is in the code, the resources or the docs it guards
   (`README.md`, `Architecture.html`, `design-system.md`, `TEST_PLAN.md`).
4. Common causes here:
   - `default-rules.contract` → a new rule sits behind an earlier rule of another category;
     reorder the block or drop the rule.
   - `localization-contract` → a key or named parameter missing from one of `he/en/fr/am.json`.
   - `documentation-contract` → a new test file not listed in `TEST_PLAN.md`.
   - `test-id-contract` → an interactive element without `data-testid`, or `page.locator(` in
     a Page Object.
   - E2E asserting on old behaviour → `dist/` is stale; rebuild.
5. Treat unexpected skips, retries and flakiness as failures to investigate, not noise.
