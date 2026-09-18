import { expect, test } from './fixtures';

/* A card report loaded through the statement control was read the wrong way round: its one
   amount column means money arriving on that path, so a household's whole month of
   spending was filed as income. The reader now recognises the file by its columns — but
   the rows already saved were still the wrong ones, and importing the file again added the
   corrected rows beside them. Getting an honest month meant deleting everything.
   The same file, read correctly, now replaces what it replaced. */

const cardReport = () => ({
  name: 'card.csv', mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך העסקה,שם בית העסק,סכום',
    '04/09/2026,פלאפל הקריה,33.00',
    '06/09/2026,APPLE.COM/BILL,39.80',
  ].join('\n')),
});

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

/* The rows a household is looking at today: saved before the reader knew the file. */
const loadMisreadRows = async (homePage: { dashboard: { loadMisreadCardRows: () => Promise<void> } }) =>
  homePage.dashboard.loadMisreadCardRows();

test('replaces a row that was read the wrong way round rather than adding a second one', async ({ homePage }) => {
  await loadMisreadRows(homePage);
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);
  const amountOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).getByTestId('transaction-amount');
  await expect(amountOf('פלאפל הקריה')).toContainText('+33.00');

  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'visa');

  await expect(homePage.dashboard.transactionRows).toHaveCount(2);
  await homePage.dashboard.openCardSummaries();
  await expect(amountOf('פלאפל הקריה')).toContainText('-33.00');
  await expect(amountOf('פלאפל הקריה')).not.toContainText('+');
});

test('says how many rows it corrected instead of replacing them quietly', async ({ homePage }) => {
  await loadMisreadRows(homePage);

  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'visa');

  await expect(homePage.toast).toContainText('2 תנועות תוקנו');
});

/* The category belongs to the charge, not to the reading of it. */
test('carries a category the customer chose across to the row that replaces it', async ({ homePage }) => {
  await loadMisreadRows(homePage);
  const categoryOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).getByTestId('transaction-category-select');
  await categoryOf('פלאפל הקריה').selectOption('leisure');

  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'visa');
  await homePage.dashboard.openCardSummaries();

  await expect(categoryOf('פלאפל הקריה')).toHaveValue('leisure');
});

/* A refund the statement itself reported is money that really arrived, and it can match a
   card charge on date, merchant and amount. Replacing it would delete a row the bank sent.
   What keeps them apart is the balance: a statement row carries the account's running
   balance, and a card report loaded through the statement control leaves rows with none. */
test('leaves a refund the statement itself reported alone', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'bank.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,זכות,יתרה',
      '04/09/2026,חנות ספרים,131,,9000',
      '04/09/2026,חנות ספרים,,130,9130',
    ].join('\n')),
  });
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);

  await homePage.upload.uploadCreditCardReport({
    name: 'card.csv', mimeType: 'text/csv',
    buffer: Buffer.from(['תאריך העסקה,שם בית העסק,סכום', '04/09/2026,חנות ספרים,130.00'].join('\n')),
  }, 'external', 'visa');
  await homePage.dashboard.openCardSummaries();

  // The statement's own pair is untouched; the card's charge is a third row.
  await expect(homePage.dashboard.transactionRows).toHaveCount(3);
  await expect(homePage.toast).not.toContainText('תוקנו');
});
