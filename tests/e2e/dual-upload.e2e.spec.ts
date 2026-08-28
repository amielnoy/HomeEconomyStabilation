import { expect, test } from './fixtures';

/* Two controls, two importers, two column vocabularies — and one list of transactions the
   customer reads as their month. Each upload has its own tests; what these cover is what
   happens when a household does the ordinary thing and loads both. */

const bankReport = (name = 'bank.csv') => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך,תיאור פעולה,חובה,זכות,יתרה',
    '02/08/2026,משכורת חודשית,,17400,20000',
    '05/08/2026,ארנונה עיריית חיפה,612,,19388',
    '09/08/2026,חשמל,486,,18902',
  ].join('\n')),
});

const cardReport = (name = 'card.csv') => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך העסקה,שם בית העסק,סכום החיוב',
    '03/08/2026,שופרסל דיל,431.00',
    '06/08/2026,נטפליקס,54.90',
  ].join('\n')),
});

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('shows the transactions from both reports together', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(bankReport());
  await expect(homePage.dashboard.transactionRows).toHaveCount(3);

  await homePage.upload.uploadCreditCardReport(cardReport());

  await expect(homePage.dashboard.transactionRows).toHaveCount(5);
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'ארנונה עיריית חיפה' })).toHaveCount(1);
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'שופרסל דיל' })).toHaveCount(1);
});

/* Nobody loads them in a fixed order, and the second upload must not be interpreted in
   terms of the first. */
test('reaches the same result whichever report is loaded first', async ({ homePage }) => {
  await homePage.upload.uploadCreditCardReport(cardReport());
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);

  await homePage.upload.uploadBankReport(bankReport());

  await expect(homePage.dashboard.transactionRows).toHaveCount(5);
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'משכורת חודשית' })).toHaveCount(1);
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'נטפליקס' })).toHaveCount(1);
});

/* Loading the same two files again is the most ordinary mistake there is, and doubling a
   household's month is the worst possible answer to it. */
test('adds nothing when both reports are loaded a second time', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(bankReport());
  await homePage.upload.uploadCreditCardReport(cardReport());
  await expect(homePage.dashboard.transactionRows).toHaveCount(5);

  await homePage.upload.uploadBankReport(bankReport());
  await expect(homePage.toast).toContainText('3 תנועות כבר היו קיימות');
  await homePage.upload.uploadCreditCardReport(cardReport());
  await expect(homePage.toast).toContainText('2 תנועות כבר היו קיימות');

  await expect(homePage.dashboard.transactionRows).toHaveCount(5);
});

/* A statement's account belongs to the statement. A card report loaded afterwards has no
   account of its own and must not be able to clear the one already shown. */
test('keeps the bank account on screen after a card report is loaded', async ({ homePage }) => {
  await homePage.upload.uploadSampleBankReport();
  await expect(homePage.dashboard.accountSummary).toContainText('04-279-661711');

  await homePage.upload.uploadCreditCardReport(cardReport());

  await expect(homePage.dashboard.accountSummary).toContainText('04-279-661711');
});

/* A file the reader cannot understand must cost the customer that file and nothing else —
   whichever control it was chosen through. */
test('keeps both imports when an unreadable file follows them', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(bankReport());
  await homePage.upload.uploadCreditCardReport(cardReport());
  await expect(homePage.dashboard.transactionRows).toHaveCount(5);

  await homePage.upload.creditCardInput.setInputFiles({
    name: 'mystery.csv', mimeType: 'text/csv', buffer: Buffer.from('עמודה א,עמודה ב\n1,2'),
  });
  await expect(homePage.toast).toContainText('mystery.csv');
  await homePage.upload.bankReportInput.setInputFiles({
    name: 'broken.csv', mimeType: 'text/csv', buffer: Buffer.from('כותרת אחת\nערך'),
  });

  await expect(homePage.dashboard.transactionRows).toHaveCount(5);
});

/* Both uploads are recorded, and the log has to say which control each file came through —
   it is the first question asked when a household reports that a month looks wrong. */
test('records both uploads and their source in the log', async ({ homePage, page }) => {
  await homePage.upload.uploadBankReport(bankReport());
  await homePage.upload.uploadCreditCardReport(cardReport());

  const sources = await page.evaluate(() => (window as unknown as { __log: { toText(): string } })
    .__log.toText()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { event: string; context?: { source?: string } })
    .filter((record) => record.event === 'report.import.completed')
    .map((record) => record.context?.source));

  expect(sources).toEqual(['bank', 'card']);
});
