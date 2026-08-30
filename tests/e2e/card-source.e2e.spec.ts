import { expect, test } from './fixtures';

/* No card export says which card it came from, so the control asks before opening the file
   dialog and stores the answer on the rows it imports. The answer is provenance: it is
   shown to the customer and saves asking twice. It deliberately does not decide
   reconciliation — every card here settles by debiting the account, so the settlement line
   is on the statement whoever issued it, and card detail is the same money twice either
   way. The two tests below pin that: the same statement and the same detail must report the
   same total under either answer. */

const cardReport = () => ({
  name: 'card.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך העסקה,שם בית העסק,סכום החיוב',
    '03/08/2026,חנות ספרים,1300.00',
    '05/08/2026,מסעדה,1000.00',
  ].join('\n')),
});

/* A statement carrying salary, one aggregate card settlement and one ordinary purchase. */
const statementWithCardSettlement = () => ({
  name: 'bank.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך,תיאור פעולה,חובה,זכות,יתרה',
    '02/08/2026,משכורת,,10000,12000',
    '10/08/2026,ישראכרט חיוב חודשי,2300,,9700',
    '12/08/2026,שופרסל דיל,400,,9300',
  ].join('\n')),
});

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('asks which card the report is from before opening the file dialog', async ({ homePage }) => {
  await homePage.upload.cardTrigger.click();

  await expect(homePage.upload.cardSourceDialog).toBeVisible();
  await expect(homePage.page.getByTestId('card-source-bank')).toBeVisible();
  await expect(homePage.page.getByTestId('card-source-external')).toBeVisible();
  // The formats the reader actually handles, so the dialog promises nothing it cannot do.
  await expect(homePage.page.getByTestId('card-source-formats')).toContainText('Excel');
});

test('imports the report once a card is chosen', async ({ homePage }) => {
  await homePage.upload.uploadCreditCardReport(cardReport());

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);
});

/* Dismissing must leave the customer exactly where they were, with no file dialog behind
   the closed one and nothing imported. */
test('imports nothing when the chooser is dismissed', async ({ homePage }) => {
  await homePage.upload.cardTrigger.click();
  await expect(homePage.upload.cardSourceDialog).toBeVisible();

  await homePage.page.getByTestId('card-source-cancel').click();

  await expect(homePage.upload.cardSourceDialog).toBeHidden();
  await expect(homePage.emptyState).toBeVisible();
});

test('closes on Escape and returns focus to the control that opened it', async ({ homePage, page }) => {
  await homePage.upload.cardTrigger.click();
  await expect(homePage.upload.cardSourceDialog).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(homePage.upload.cardSourceDialog).toBeHidden();
  await expect(homePage.upload.cardTrigger).toBeFocused();
});

/* The household spent 2,700: 400 of groceries and 2,300 on the card. Once the card detail
   is imported, the statement's settlement line is that same 2,300 itemised, so it stops
   being spending of its own. */
for (const issuer of ['bank', 'external'] as const) {
  test(`counts card spending once when the card is ${issuer}`, async ({ homePage }) => {
    await homePage.upload.uploadBankReport(statementWithCardSettlement());
    expect(await homePage.dashboard.readMonthlyOutflow()).toBe(2700);

    await homePage.upload.uploadCreditCardReport(cardReport(), issuer);

    /* Not 5,000. The default rules categorise ישראכרט and every other issuer here as
       `credit` precisely because their settlement debits the account, so excluding one of
       them from reconciliation left the settlement standing beside its own itemisation. */
    expect(await homePage.dashboard.readMonthlyOutflow()).toBe(2700);
  });
}

test('records the chosen issuer in the log', async ({ homePage, page }) => {
  await homePage.upload.uploadCreditCardReport(cardReport(), 'external');

  const events = await page.evaluate(() => (window as unknown as { __log: { toText(): string } })
    .__log.toText()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { event: string; context?: Record<string, unknown> }));

  const chosen = events.find((record) => record.event === 'ui.card-source.chosen');
  expect(chosen?.context).toMatchObject({ cardKind: 'external' });
  expect(events.find((record) => record.event === 'report.import.started')?.context)
    .toMatchObject({ source: 'card', cardKind: 'external' });
});

/* The answer belongs to the transactions, not to the session, so the customer is not asked
   again for rows that already carry it. */
test('remembers the issuer across a reload', async ({ homePage, page }) => {
  await homePage.upload.uploadCreditCardReport(cardReport(), 'external');
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);

  await homePage.reload();

  await expect(homePage.dashboard.root).toBeVisible();
  const kinds = await page.evaluate(() => {
    const raw = localStorage.getItem('mazan-habait/v2') ?? localStorage.getItem('mazan-habait/v1') ?? '{}';
    return ((JSON.parse(raw).tx ?? []) as Array<{ cardKind?: string }>).map((row) => row.cardKind);
  });
  expect(kinds).toEqual(['external', 'external']);
});

/* A dialog keeps the value it closed with, so a dismissal after an earlier choice would
   otherwise read as that choice and open the file dialog the customer just declined. */
test('does not reuse the previous answer when reopened and dismissed', async ({ homePage, page }) => {
  await homePage.upload.uploadCreditCardReport(cardReport(), 'bank');
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);

  await homePage.upload.cardTrigger.click();
  await expect(homePage.upload.cardSourceDialog).toBeVisible();
  let chooserOpened = false;
  page.once('filechooser', () => { chooserOpened = true; });
  await page.keyboard.press('Escape');
  await expect(homePage.upload.cardSourceDialog).toBeHidden();

  expect(chooserOpened, 'a dismissal reopened the file dialog').toBe(false);
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);
});
