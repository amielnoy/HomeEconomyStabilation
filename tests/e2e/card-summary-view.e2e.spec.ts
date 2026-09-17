import { expect, test } from './fixtures';

/* A household that imported a statement and its card detail was reading one list where
   the card's charges outnumbered everything the bank did, and the settlement line the
   statement carries sat among them describing the same money a second time. The table
   now opens on the account as the bank describes it — statement rows, and one line per
   card carrying the full sum it charged — with the charges one click underneath. */

const statement = () => ({
  name: 'bank.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך,תיאור פעולה,חובה,זכות,יתרה',
    '02/08/2026,משכורת,,10000,12000',
    '12/08/2026,שופרסל דיל,400,,11600',
  ].join('\n')),
});

const cardReport = () => ({
  name: 'card.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך העסקה,שם בית העסק,סכום החיוב',
    '03/08/2026,חנות ספרים,130.00',
    '05/08/2026,בית קפה,42.50',
  ].join('\n')),
});

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('opens on the statement with each card folded to the sum it charged', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());
  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'isracard');

  await expect(homePage.dashboard.cardGroupRows).toHaveCount(1);
  await expect(homePage.dashboard.cardGroupSources).toHaveText('ישראכרט');
  await expect(homePage.dashboard.cardGroupAmounts).toHaveText(/172\.50/);
  // The statement rows stand beside it, itemised as they always were.
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'חנות ספרים' })).toHaveCount(0);
});

/* The sum is not the end of the story: a household asking what the card was charged for
   has nowhere else to look, so the charges open in place and stay ordinary rows — the
   category can still be corrected from inside the card. */
test('opens a card onto the charges behind its sum', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());
  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'isracard');

  await expect(homePage.dashboard.cardGroupToggles).toHaveAttribute('aria-expanded', 'false');
  await homePage.dashboard.openCardSummaries();

  await expect(homePage.dashboard.cardGroupToggles).toHaveAttribute('aria-expanded', 'true');
  await expect(homePage.dashboard.transactionRows).toHaveCount(4);
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'חנות ספרים' })
    .getByTestId('transaction-category-select')).toBeVisible();
});

test('itemises every charge when the reader asks for them', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());
  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'isracard');

  await homePage.dashboard.showEveryCharge();

  await expect(homePage.dashboard.cardGroupRows).toHaveCount(0);
  await expect(homePage.dashboard.transactionRows).toHaveCount(4);
});

/* A card-only household has no settlement line to read the charges against. Folding them
   there would answer "what did we spend?" with a single number and nothing else. */
test('itemises a card report that arrived without a statement', async ({ homePage }) => {
  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'isracard');

  await expect(homePage.dashboard.cardGroupRows).toHaveCount(0);
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);
});

/* Folding is how the month is read, not what it came to. The totals line counts the
   charges themselves in either view, or switching views would look like money moving. */
test('reports the same count and totals in both views', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());
  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'isracard');

  const folded = await homePage.dashboard.transactionCount.innerText();
  await homePage.dashboard.showEveryCharge();

  await expect(homePage.dashboard.transactionCount).toHaveText(folded);
});
