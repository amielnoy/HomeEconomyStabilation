import { expect, test } from './fixtures';

/* Every row says where the figure came from. A statement line is the bank's word; a card
   line is the issuer's, and which issuer is the customer's answer at import because no
   export names the company that sent it. The column exists so a household reading a total
   can tell which report it is looking at rather than inferring it from the description. */

const cardReport = () => ({
  name: 'card.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך העסקה,שם בית העסק,סכום החיוב',
    '03/08/2026,חנות ספרים,1300.00',
  ].join('\n')),
});

const statement = () => ({
  name: 'bank.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך,תיאור פעולה,חובה,זכות,יתרה',
    '02/08/2026,משכורת,,10000,12000',
    '12/08/2026,שופרסל דיל,400,,11600',
  ].join('\n')),
});

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('names the bank as the source of every statement row', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());

  await expect(homePage.dashboard.transactionSources).toHaveCount(2);
  for (const cell of await homePage.dashboard.transactionSources.all()) {
    await expect(cell).toHaveText('בנק');
  }
});

test('names the issuer the customer chose on the rows a card report brought in', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());
  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'isracard');

  const sourceOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).getByTestId('transaction-source');

  await expect(sourceOf('חנות ספרים')).toHaveText('ישראכרט');
  // The statement rows beside it keep saying what they are.
  await expect(sourceOf('שופרסל')).toHaveText('בנק');
});

/* Declining to name the issuer has to read as a card whose issuer is unknown, not as a
   card called "other" and not as the bank. */
test('says only that a row is a card when the issuer was not named', async ({ homePage }) => {
  await homePage.upload.uploadCreditCardReport(cardReport(), 'bank');

  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'חנות ספרים' })
    .getByTestId('transaction-source')).toHaveText('כרטיס אשראי');
});

test('remembers the issuer across a reload', async ({ homePage }) => {
  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'diners');
  await homePage.reload();

  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'חנות ספרים' })
    .getByTestId('transaction-source')).toHaveText('דיינרס');
});

/* A brand chosen for one import must not be recorded against the next one, which is what
   a dialog that keeps its last value would do. */
test('does not carry an issuer over to a later import that did not name one', async ({ homePage }) => {
  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'amex');
  await homePage.upload.uploadCreditCardReport({
    name: 'second.csv', mimeType: 'text/csv', buffer: Buffer.from([
      'תאריך העסקה,שם בית העסק,סכום החיוב',
      '09/08/2026,בית מרקחת,90.00',
    ].join('\n')),
  }, 'external');

  const sourceOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).getByTestId('transaction-source');

  await expect(sourceOf('חנות ספרים')).toHaveText('אמריקן אקספרס');
  await expect(sourceOf('בית מרקחת')).toHaveText('כרטיס אשראי');
});

test('offers the source column and its issuers in every language', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());

  const names = [
    ['he', 'מקור', 'בנק'],
    ['en', 'Source', 'Bank'],
    ['fr', 'Source', 'Banque'],
  ] as const;

  for (const [locale, heading, bank] of names) {
    await homePage.language.choose(locale);
    await expect(homePage.html).toHaveAttribute('lang', locale);
    await expect(homePage.page.locator('th[data-i18n="transactionSource"]')).toHaveText(heading);
    await expect(homePage.dashboard.transactionSources.first()).toHaveText(bank);
  }
});
