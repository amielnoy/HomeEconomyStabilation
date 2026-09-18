import { expect, test } from './fixtures';

/* The rows a household is looking at today were saved before the reader recognised a card
   report loaded through the statement control: a whole month of merchants written in green
   with a plus. Correcting the reader fixed the next import and left those rows alone, and
   telling a household to delete everything it has is not a fix. */

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
  await homePage.dashboard.loadMisreadCardRows();
});

test('offers to correct the rows where the household is looking at them', async ({ homePage }) => {
  await expect(homePage.dashboard.repairButton).toBeVisible();
  await expect(homePage.dashboard.repairButton).toContainText('2');
});

test('turns the money round and files each row by what it is', async ({ homePage }) => {
  await homePage.dashboard.repairMisreadRows();

  const amountOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).getByTestId('transaction-amount');
  await expect(amountOf('APPLE.COM/BILL')).toContainText('-39.80');
  await expect(amountOf('APPLE.COM/BILL')).not.toContainText('+');
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'APPLE.COM/BILL' })
    .getByTestId('transaction-category-select')).toHaveValue('computing');
  await expect(homePage.dashboard.transactionCount).toContainText('73');
});

/* It rewrites rows the customer did not choose one at a time, so it asks twice — and the
   offer goes away once it has been taken, rather than sitting there inviting a second run. */
test('asks twice, and stops offering once there is nothing left to correct', async ({ homePage }) => {
  await homePage.dashboard.repairButton.click();
  await expect(homePage.dashboard.repairButton).toContainText('לחצו שוב');
  await expect(homePage.dashboard.transactionAmounts.first()).toContainText('+');

  await homePage.dashboard.repairButton.click();

  await expect(homePage.dashboard.repairButton).toBeHidden();
  await expect(homePage.toast).toContainText('2 תנועות תוקנו');
});

test('keeps the correction across a reload', async ({ homePage, page }) => {
  await homePage.dashboard.repairMisreadRows();
  await page.reload();

  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'פלאפל הקריה' })
    .getByTestId('transaction-amount')).toContainText('-33.00');
  await expect(homePage.dashboard.repairButton).toBeHidden();
});

/* The offer must not appear for a household whose rows the reader understood. */
test('says nothing to a household whose statement was read correctly', async ({ homePage }) => {
  await homePage.openFresh();
  await homePage.upload.uploadBankReport({
    name: 'bank.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,זכות,יתרה',
      '02/09/2026,משכורת,,29000,29000',
      '03/09/2026,ארנונה עיריית חיפה,1240,,27760',
    ].join('\n')),
  });

  await expect(homePage.dashboard.repairButton).toBeHidden();
});

/* A category the customer chose belongs to the charge, not to the reading of it. */
test('carries a chosen category across the correction', async ({ homePage }) => {
  const categoryOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).getByTestId('transaction-category-select');
  await categoryOf('פלאפל הקריה').selectOption('leisure');

  await homePage.dashboard.repairMisreadRows();

  await expect(categoryOf('פלאפל הקריה')).toHaveValue('leisure');
});
