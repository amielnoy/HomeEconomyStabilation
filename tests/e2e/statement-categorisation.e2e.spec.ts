import { expect, test } from './fixtures';

/* Merchant names taken from a real statement that the defaults filed as "other" or filed
   wrongly. Business names only — no account holder, counterparty or identifier appears
   here, and none is needed: what is being pinned is the rule, not the customer.

   Two of these were defects rather than gaps. 'עיריי' matched only עיריית and never the
   commoner עירית, so a municipal charge reached no household rule at all; and the transport
   operators a statement actually names were absent while the intercity ones were present. */

const statement = () => ({
  name: 'statement.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך,תיאור פעולה,חובה,יתרה',
    '02/09/2026,עירית קרית אתא,436,9000',
    '03/09/2026,APPLE.COM/BILL,20,8980',
      /* Quoted as a real export writes it: the gershayim in בע"מ is a CSV quote too. */
    '04/09/2026,"קיי אס פי הקריון בע""מ-גמא",250,8730',
    '05/09/2026,Shein,48,8682',
    '06/09/2026,בגדי רינה,169,8513',
    '07/09/2026,פעמונים ארגון הוק,100,8413',
    '08/09/2026,אופטיקה כהן קרית מוצקין,267,8146',
    '09/09/2026,דן חברה לתחבורה ציבורית,10,8136',
    '10/09/2026,פלאפל הקריה,30,8106',
    '11/09/2026,PAYBOX,30,8076',
  ].join('\n')),
});

test('categorises the merchants a real statement left as other', async ({ homePage }) => {
  await homePage.openFresh();
  await homePage.upload.uploadBankReport(statement());

  const categoryOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).getByTestId('transaction-category-select');

  const expected = [
    // A municipality is written both ways; only one spelling used to be matched.
    ['עירית', 'home'],
    ['APPLE.COM', 'computing'],
    ['קיי אס פי', 'computing'],
    ['Shein', 'clothing'],
    ['בגדי רינה', 'clothing'],
    ['פעמונים', 'donations'],
    ['אופטיקה', 'health'],
    ['דן חברה', 'transit'],
    ['פלאפל', 'food'],
    // Moving money between the household's own places is a transfer, not a purchase.
    ['PAYBOX', 'savings'],
  ] as const;

  for (const [merchant, category] of expected) {
    await expect(categoryOf(merchant), `${merchant} should be ${category}`).toHaveValue(category);
  }
});
