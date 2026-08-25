import { expect, test } from './fixtures';

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

/* A card settlement on the bank statement and the card's own line items are the same
   money described twice; counting both inflates every total on the dashboard. */
test('counts card spending once when both the bank and card reports are imported', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'bank.csv', mimeType: 'text/csv', buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,זכות,יתרה',
      '02/08/2026,משכורת,,10000,12000',
      '10/08/2026,ישראכרט חיוב חודשי,2300,,9700',
      '12/08/2026,שופרסל דיל,400,,9300',
    ].join('\n')),
  });

  const withBankOnly = await homePage.dashboard.readMonthlyOutflow();
  expect(withBankOnly, 'the settlement is the only record of that spending so far').toBe(2700);

  await homePage.upload.uploadCreditCardReport({
    name: 'card.csv', mimeType: 'text/csv', buffer: Buffer.from([
      'תאריך עסקה,שם בית עסק,סכום עסקה',
      '03/08/2026,חנות ספרים,1300',
      '05/08/2026,מסעדה,1000',
    ].join('\n')),
  });

  // 400 groceries + 2300 of now-itemised card spending — not 5000.
  const withCardDetail = await homePage.dashboard.readMonthlyOutflow();
  expect(withCardDetail).toBe(2700);
});
