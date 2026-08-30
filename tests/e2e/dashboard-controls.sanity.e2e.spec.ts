import { expect, test } from './fixtures';
import { richBankReport } from './reports';

/* The controls a household touches every time it opens the dashboard — search, the two
   filters, the month chips, the forecast horizon and the category view toggle. Every one of
   them narrows or reshapes what the customer is reading, and none of them had a test: a
   filter that silently matched nothing, or a month chip that changed the heading without
   changing the rows, would look like missing money rather than a broken control. */

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
  await homePage.upload.uploadBankReport(richBankReport());
  await expect(homePage.dashboard.root).toBeVisible();
});

test('narrows the table to what the search matches, and restores it when cleared', async ({ homePage, page }) => {
  const all = await homePage.dashboard.transactionRows.count();
  expect(all).toBeGreaterThan(1);

  await page.getByTestId('q').fill('נטפליקס');

  const matched = homePage.dashboard.transactionRows;
  await expect(matched).not.toHaveCount(all);
  expect(await matched.count()).toBeGreaterThan(0);
  for (const row of await matched.all()) await expect(row).toContainText('נטפליקס');

  await page.getByTestId('q').fill('');

  await expect(homePage.dashboard.transactionRows).toHaveCount(all);
});

test('says so plainly when the search matches nothing', async ({ homePage, page }) => {
  await page.getByTestId('q').fill('אין-כזה-בית-עסק');

  await expect(homePage.dashboard.transactionRows).toHaveCount(0);
  // The table stays on screen rather than the dashboard looking empty of data.
  await expect(homePage.dashboard.root).toBeVisible();
});

test('filters the table down to one category', async ({ homePage, page }) => {
  const all = await homePage.dashboard.transactionRows.count();

  await page.getByTestId('f-cat').selectOption('home');

  const rows = homePage.dashboard.transactionRows;
  await expect(rows).not.toHaveCount(all);
  // A filter that matches nothing would also satisfy the line above.
  expect(await rows.count()).toBeGreaterThan(0);
  for (const select of await rows.getByTestId('transaction-category-select').all()) {
    await expect(select).toHaveValue('home');
  }
});

test('filters the table down to money coming in', async ({ homePage, page }) => {
  await page.getByTestId('f-dir').selectOption('in');

  const rows = homePage.dashboard.transactionRows;
  expect(await rows.count()).toBeGreaterThan(0);
  // The rich report's only income is the monthly salary.
  for (const row of await rows.all()) await expect(row).toContainText('משכורת');
});

/* The scope control is the difference between reading one month and reading the history. */
test('widens the table from the selected month to the whole history', async ({ homePage, page }) => {
  const inMonth = await homePage.dashboard.transactionRows.count();

  await page.getByTestId('f-scope').selectOption('all');

  expect(await homePage.dashboard.transactionRows.count()).toBeGreaterThan(inMonth);
});

test('changes the transactions on screen when another month is chosen', async ({ homePage }) => {
  const chips = homePage.dashboard.monthChips;
  expect(await chips.count()).toBeGreaterThan(1);
  const firstMonthRows = await homePage.dashboard.transactionRows.allTextContents();

  await chips.nth(1).click();

  await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
  expect(await homePage.dashboard.transactionRows.allTextContents()).not.toEqual(firstMonthRows);
});

test('keeps exactly one month selected at a time', async ({ homePage }) => {
  const chips = homePage.dashboard.monthChips;

  await chips.nth(1).click();

  let pressed = 0;
  for (const chip of await chips.all()) {
    if (await chip.getAttribute('aria-pressed') === 'true') pressed += 1;
  }
  expect(pressed).toBe(1);
});

test('redraws the forecast when the horizon changes', async ({ homePage, page }) => {
  const table = homePage.page.getByTestId('fc-table');
  const at90 = await table.textContent();
  expect((at90 ?? '').trim().length, 'the forecast table is empty to begin with').toBeGreaterThan(0);

  await page.getByTestId('fc-horizon').selectOption('30');

  await expect(table).not.toHaveText(at90 ?? '');
});

/* The category breakdown is a chart for people who read charts and a table for people who
   read numbers — and for anyone using a screen reader. */
test('swaps the category breakdown between chart and table', async ({ homePage, page }) => {
  const toggle = page.getByTestId('btn-cattbl');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('cat-table')).toBeHidden();

  await toggle.click();

  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('cat-table')).toBeVisible();
  await expect(page.getByTestId('cat-list')).toBeHidden();

  await toggle.click();

  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('cat-table')).toBeHidden();
});

/* Filters narrow the reading, they do not change the household's month. */
test('leaves the month totals alone while a filter is applied', async ({ homePage, page }) => {
  const outflow = await homePage.dashboard.readMonthlyOutflow();

  await page.getByTestId('f-dir').selectOption('in');

  expect(await homePage.dashboard.readMonthlyOutflow()).toBe(outflow);
});
