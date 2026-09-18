import { expect, test } from './fixtures';

/* Which side of a statement a figure belongs on is the reader's judgement about a file,
   and it is wrong often enough — a card report read as a statement, an issuer that books an
   insurance premium as a credit — that a household needs a way to say so about one row.
   Every other correction here rewrites rows in bulk on evidence; this one rewrites the row
   the customer is pointing at, which needs no evidence at all. */

const cardWithACredit = () => ({
  name: 'card.csv', mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך העסקה,שם בית העסק,סכום החיוב',
    '10/09/2026,מגדל חיים בריאות,-139.06',
    '10/09/2026,סופר יוחננוף,412.30',
  ].join('\n')),
});

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
  await homePage.upload.uploadCreditCardReport(cardWithACredit(), 'external');
});

test('turns one row into spending when the customer says it is', async ({ homePage }) => {
  const row = homePage.dashboard.transactionRows.filter({ hasText: 'מגדל' });
  await expect(row.getByTestId('transaction-amount')).toContainText('+139.06');

  await row.getByTestId('transaction-flip').click();

  await expect(row.getByTestId('transaction-amount')).toContainText('-139.06');
  await expect(row.getByTestId('transaction-amount')).not.toContainText('+');
});

/* Colour follows the money, so the row it was said about reads as spending everywhere. */
test('colours the row it was said about', async ({ homePage }) => {
  const spent = await homePage.dashboard.resolvedColour('--crit-text');
  const row = homePage.dashboard.transactionRows.filter({ hasText: 'מגדל' });

  await row.getByTestId('transaction-flip').click();

  for (const cell of await row.locator('td').all()) {
    await expect(cell).toHaveCSS('color', spent);
  }
});

/* Said in one direction, it can be said back: a row marked by mistake is one click from
   where it was. */
test('takes it back', async ({ homePage }) => {
  const row = homePage.dashboard.transactionRows.filter({ hasText: 'מגדל' });
  await row.getByTestId('transaction-flip').click();

  await row.getByTestId('transaction-flip').click();

  await expect(row.getByTestId('transaction-amount')).toContainText('+139.06');
});

test('keeps what the customer said across a reload', async ({ homePage, page }) => {
  await homePage.dashboard.transactionRows.filter({ hasText: 'מגדל' }).getByTestId('transaction-flip').click();

  await page.reload();

  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'מגדל' })
    .getByTestId('transaction-amount')).toContainText('-139.06');
});

/* The category belongs to the charge, not to the side the money was read on. */
test('carries a chosen category across', async ({ homePage }) => {
  const row = homePage.dashboard.transactionRows.filter({ hasText: 'מגדל' });
  await row.getByTestId('transaction-category-select').selectOption('health');

  await row.getByTestId('transaction-flip').click();

  await expect(row.getByTestId('transaction-category-select')).toHaveValue('health');
});

test('names the row it is about, for a reader who cannot see the arrow', async ({ homePage }) => {
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'מגדל' })
    .getByTestId('transaction-flip')).toHaveAttribute('aria-label', /מגדל חיים בריאות/);
});

test('leaves every other row where it was', async ({ homePage }) => {
  await homePage.dashboard.transactionRows.filter({ hasText: 'מגדל' }).getByTestId('transaction-flip').click();

  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'סופר יוחננוף' })
    .getByTestId('transaction-amount')).toContainText('-412.30');
});
