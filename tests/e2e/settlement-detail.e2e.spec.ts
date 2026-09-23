import { expect, test } from './fixtures';

/* A card settlement on the statement is a figure with nothing behind it: the household
   recognises the company and the sum, and has to take the rest on trust. The charges that
   sum paid for are already in the app whenever the card report was imported — so the line
   opens onto them, and what opens comes to exactly the figure on the line it opened from.
   A bill the app cannot account for says so instead of showing a list that disagrees. */

const SETTLEMENT = 548.10;

/* One statement carrying a salary and the card's settlement, and one card report whose
   charges come to exactly what the bank took. Synthetic amounts, business names only. */
const statement = () => ({
  name: 'bank.csv', mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך,תיאור פעולה,חובה,זכות,יתרה',
    '02/09/2026,משכורת,,18400,18400',
    `10/09/2026,ישראכרט,${SETTLEMENT},,${(18400 - SETTLEMENT).toFixed(2)}`,
  ].join('\n')),
});

const cardReport = () => ({
  name: 'card-august.csv', mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך העסקה,שם בית העסק,סכום החיוב',
    '04/08/2026,שופרסל דיל,431.20',
    '11/08/2026,פנגו חניה,62.00',
    '19/08/2026,נטפליקס,54.90',
  ].join('\n')),
});

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('opens a settlement onto the charges it paid for', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());
  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'isracard');

  const settlement = homePage.dashboard.billToggles.filter({ hasText: 'ישראכרט' });
  await expect(settlement).toHaveAttribute('aria-expanded', 'false');
  await settlement.click();
  await expect(settlement).toHaveAttribute('aria-expanded', 'true');

  for (const merchant of ['שופרסל דיל', 'פנגו חניה', 'נטפליקס']) {
    await expect(homePage.dashboard.transactionRows.filter({ hasText: merchant })).toHaveCount(1);
  }
});

/* The point of the whole feature: the list that opens has to come to the line it opened
   from. A household reads a bill to reconcile it, and a total that disagrees sends it
   looking for a charge that was never missing. */
test('shows charges that come to exactly the figure on the settlement line', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());
  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'isracard');
  await homePage.dashboard.billToggles.filter({ hasText: 'ישראכרט' }).click();

  const amounts = homePage.dashboard.transactionRows
    .filter({ hasText: /שופרסל דיל|פנגו חניה|נטפליקס/ })
    .getByTestId('transaction-amount');
  const texts = await amounts.allInnerTexts();
  const total = texts.reduce((sum, text) => sum + Number(text.replace(/[^0-9.]/g, '')), 0);

  expect(total).toBeCloseTo(SETTLEMENT, 2);
});

/* August's charges belong to September's bill, and the month filter is on September. The
   bill's detail is shown because it is what the line is made of, and never counted: the
   totals line above still describes the month the household chose. */
test('leaves the month totals alone when a bill from another month is opened', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());
  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'isracard');

  const before = await homePage.dashboard.transactionCount.innerText();
  await homePage.dashboard.billToggles.filter({ hasText: 'ישראכרט' }).click();

  await expect(homePage.dashboard.transactionCount).toHaveText(before);
});

/* Without the detail there is nothing to show, and nothing is what it says — rather than
   a plausible list of the month's card charges that the bill never paid for. */
test('says so when the detail behind a bill was never imported', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'bank.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,זכות,יתרה',
      '02/09/2026,משכורת,,18400,18400',
      '10/09/2026,ישראכרט,4812.37,,13587.63',
    ].join('\n')),
  });
  /* A card report for a different figure: card detail exists, so the line offers to open,
     but nothing in the app accounts for this bill. */
  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'isracard');

  await homePage.dashboard.billToggles.filter({ hasText: 'ישראכרט' }).click();

  await expect(homePage.dashboard.billUnexplained).toBeVisible();
  await expect(homePage.dashboard.billUnexplained).toContainText('לא נטען');
});

/* A household that never imported a card report has no bill to open anywhere, and a caret
   on every card line would promise detail the app does not have. */
test('offers nothing to open when no card report was ever imported', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());

  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'ישראכרט' })).toHaveCount(1);
  await expect(homePage.dashboard.billToggles).toHaveCount(0);
});
