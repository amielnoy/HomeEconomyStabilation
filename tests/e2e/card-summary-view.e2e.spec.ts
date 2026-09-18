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
  // The line is the card's bill, whoever issued the card, so that is what it is filed as.
  await expect(homePage.dashboard.cardGroupCategory).toHaveText('כרטיסי אשראי');
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

/* Whoever issued the card — a bank or a credit company — the folded line is a card's bill
   and is filed as one. Naming the single category its charges happened to share said
   "פנאי ובידור" about a card, and naming none of them said "מעורב", which is not
   something a household can act on or budget against. */
test.describe('the classification on a folded card', () => {
  const singleCategoryCard = () => ({
    name: 'card.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'תאריך העסקה,שם בית העסק,סכום החיוב',
      '03/08/2026,נטפליקס,54.90',
      '05/08/2026,ספוטיפיי,19.90',
    ].join('\n')),
  });

  for (const issuer of ['bank', 'external'] as const) {
    test(`files a ${issuer}-issued card's charges as a credit-card bill`, async ({ homePage }) => {
      await homePage.upload.uploadBankReport(statement());
      await homePage.upload.uploadCreditCardReport(singleCategoryCard(), issuer, 'visa');

      await expect(homePage.dashboard.cardGroupCategory).toHaveText('כרטיסי אשראי');
    });
  }

  /* The charges underneath keep the categories they earned — folding the card does not
     recategorise a household's spending, it only names the line that stands for it. */
  test('leaves the charges underneath in the categories they were given', async ({ homePage }) => {
    await homePage.upload.uploadBankReport(statement());
    await homePage.upload.uploadCreditCardReport(singleCategoryCard(), 'external', 'visa');
    await homePage.dashboard.openCardSummaries();

    await expect(homePage.dashboard.transactionRows.filter({ hasText: 'נטפליקס' })
      .getByTestId('transaction-category-select')).toHaveValue('leisure');
  });
});

/* The line reads as a total and gives no sign that it opens: a household looking at
   "כרטיס אשראי · 22 חיובים" has no way to know the 22 are one click away. The caret hints
   at it and aria-expanded says so to a screen reader; the tooltip says what the click does
   for everyone else. */
test('says what clicking a folded card will do', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());
  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'isracard');

  const toggle = homePage.dashboard.cardGroupToggles.first();
  await expect(toggle).toHaveAttribute('title', /תפרוס/);
  await expect(toggle).toHaveAttribute('title', /2/);
  await expect(toggle).toHaveAttribute('title', /ישראכרט/);

  await homePage.dashboard.openCardSummaries();

  // Open, it offers the way back rather than repeating the offer to open.
  await expect(toggle).toHaveAttribute('title', /תקפל/);
});

test('says it in every language', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());
  await homePage.upload.uploadCreditCardReport(cardReport(), 'external', 'isracard');

  for (const [locale, wording] of [['en', /Click to open/], ['fr', /Cliquez pour afficher/]] as const) {
    await homePage.language.choose(locale);
    await expect(homePage.dashboard.cardGroupToggles.first()).toHaveAttribute('title', wording);
  }
});
