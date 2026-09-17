import { expect, test } from './fixtures';

/* Which reader a file needs is a property of the file, not of the button it was chosen
   through. A card report loaded as a statement reads its one amount column as money
   arriving, and a household's whole month of spending was shown as income — merchant
   after merchant filed as הכנסות, with the safe-to-spend figure built on top of it. */

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

/* The file a household has does not know which button it was chosen through. Loaded as a
   statement, a card report's single amount column reads as money arriving, and a month of
   spending was shown as a month of income — merchant after merchant filed as הכנסות. The
   columns say what the file is, and the message says which reader read it. */
test('files a card report chosen through the bank control as spending', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'card-through-bank.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'תאריך העסקה,שם בית העסק,סכום',
      '03/09/2026,פלאפל הקריה,33.00',
      '04/09/2026,סופר יוחננוף,412.30',
    ].join('\n')),
  });

  await expect(homePage.toast).toContainText('נקרא כדוח אשראי');
  const amountOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).getByTestId('transaction-amount');
  await expect(amountOf('פלאפל הקריה')).toContainText('-33.00');
  await expect(amountOf('פלאפל הקריה')).not.toContainText('+');
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'סופר יוחננוף' })
    .getByTestId('transaction-category-select')).not.toHaveValue('income');
});

/* A statement keeps being a statement: its credits are still money arriving. */
test('leaves a statement on the statement reader', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());

  await expect(homePage.toast).not.toContainText('נקרא כדוח אשראי');
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'משכורת' })
    .getByTestId('transaction-amount')).toContainText('+10,000.00');
});
