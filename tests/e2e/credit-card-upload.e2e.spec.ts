import { test, expect } from './fixtures';
import { htmlBankReport, issuerCardReport, spreadsheetMlCardReport } from './reports';

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('uploads and processes the supplied bank workbook', async ({ homePage }) => {
  await homePage.upload.uploadSampleBankReport();

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.monthChips).toContainText('אוגוסט 2026');
  await expect(homePage.dashboard.transactionRows).toHaveCount(5);
  await expect(homePage.dashboard.accountSummary).toContainText('04-279-661711');
});

/* Several Israeli banks name an HTML document .xls. Excel opens it, so the bank
   calls it a spreadsheet; before this it failed the import with nothing said about
   why, and the customer had no way to tell a bad file from an unsupported one. */
test('imports a statement that is really an HTML table named .xls', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(htmlBankReport());

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.transactionRows).toHaveCount(4);
  await expect(homePage.dashboard.accountSummary).toContainText('04-279-661711');
  // Hebrew survives the windows-1255 body, so the rules can still categorise it.
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'שופרסל דיל' })).toHaveCount(1);
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'משיכה מבנקט' })).toHaveCount(1);
});

test('exposes the credit-card upload control in the live UI', async ({ homePage }) => {
  const input = homePage.upload.creditCardInput;

  await expect(input).toHaveAttribute('accept', /\.xls/);
  await expect(input).toHaveAttribute('multiple', '');
});

/* The control was wired up but no issuer's column names matched it, so choosing a card
   report left the customer on the empty state with "the file could not be read". */
test('imports a credit-card report through the card upload control', async ({ homePage }) => {
  await homePage.upload.uploadCreditCardReport(issuerCardReport());

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.transactionRows).toHaveCount(4);
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'שופרסל דיל' })).toHaveCount(1);
  // Billed in shekels, not the 40 dollars the purchase was made in.
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'AMAZON US' })).toContainText('148.2');
});

/* Asking an issuer for Excel can return XML named .xls; it reached the HTML reader,
   which found no table rows in it and left the customer with an empty report. */
test('imports a credit-card report exported as SpreadsheetML named .xls', async ({ homePage }) => {
  await homePage.upload.uploadCreditCardReport(spreadsheetMlCardReport());

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'שופרסל דיל' })).toHaveCount(1);
});

test('classifies evidenced transfers and alimony while leaving unexplained debits as other', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'classification.csv', mimeType: 'text/csv', buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,יתרה',
      '09/08/2026,המבצע: עמיאל פלד עבור: משיכה לחשבון הבנק,300,1000',
      '10/08/2026,לטובת: אסתר אושרית פלד עבור: מזונות,3000,-2000',
      '11/08/2026,,50,-2050',
    ].join('\n')),
  });

  await expect(homePage.dashboard.transactionCategories).toHaveCount(3);
  await expect(homePage.dashboard.transactionCategories.nth(0)).toHaveValue('other');
  await expect(homePage.dashboard.transactionCategories.nth(1)).toHaveValue('home');
  await expect(homePage.dashboard.transactionCategories.nth(2)).toHaveValue('savings');
});

/* A loan repayment is usually worded as a transfer or a standing order, so before
   the loans rules "העברה" claimed it for savings and it read as money the household
   still had. A mortgage stays in housing: it is where someone lives before it is a
   loan, and moving it would empty the housing figure people budget against. */
test('separates loan repayments from housing and from transfers', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'loans.csv', mimeType: 'text/csv', buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,יתרה',
      '05/08/2026,החזר הלוואה בנקאית,1200,5000',
      '06/08/2026,הוראת קבע הלואה 12345,800,4200',
      '07/08/2026,תשלום משכנתא,4000,200',
    ].join('\n')),
  });

  await expect(homePage.dashboard.transactionCategories).toHaveCount(3);
  await expect(homePage.dashboard.transactionCategories.nth(0)).toHaveValue('home');
  // Both spellings a statement might carry.
  await expect(homePage.dashboard.transactionCategories.nth(1)).toHaveValue('loans');
  await expect(homePage.dashboard.transactionCategories.nth(2)).toHaveValue('loans');
});

test('offers loans as a category in every language', async ({ homePage }) => {
  await homePage.upload.uploadSampleBankReport();
  const picker = homePage.dashboard.transactionCategories.first();

  for (const [locale, name] of [['he', 'הלוואות'], ['en', 'Loans'], ['fr', 'Prêts']] as const) {
    await homePage.language.choose(locale);
    await expect(homePage.html).toHaveAttribute('lang', locale);
    await expect(picker.locator('option[value="loans"]')).toHaveText(name);
  }
});

test('shows prioritized customer recommendations', async ({ homePage }) => {
  await homePage.upload.uploadSampleBankReport();
  await expect(homePage.dashboard.root).toBeVisible();

  await homePage.dashboard.openRecommendations();
  await expect(homePage.dashboard.recommendations).toBeVisible();
  await expect(homePage.dashboard.recommendationNote).toContainText('חשבון 04-279-661711');
  await expect(homePage.dashboard.recommendationCards).not.toHaveCount(0);
  await expect(homePage.dashboard.recommendationActions.first()).toBeVisible();
});

test('guides the customer to import data when recommendations are not ready yet', async ({ homePage }) => {
  await homePage.dashboard.openRecommendations();

  await expect(homePage.toast).toContainText('כדי לקבל המלצות, טענו תחילה דוח בנק');
  await expect(homePage.marketing.primaryUpload).toBeFocused();
  await expect(homePage.emptyState).toBeVisible();
});
