import { test, expect } from './fixtures';
import {
  htmlBankReport, issuerCardReport, spreadsheetMlCardReport, windows1255CardReport,
  xlsxCardReport, xlsxCardReportWithoutReferences,
} from './reports';

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

/* "1 file could not be read" gave the customer nothing to act on and support nothing to
   diagnose; naming the columns the reader did find identifies the layout at a glance. */
test('names the file and the columns it found when a report is not recognised', async ({ homePage }) => {
  await homePage.upload.creditCardInput.setInputFiles({
    name: 'mystery.csv', mimeType: 'text/csv',
    buffer: Buffer.from(['עמודה א,עמודה ב,עמודה ג', '1,2,3'].join('\n')),
  });

  await expect(homePage.toast).toContainText('mystery.csv');
  await expect(homePage.toast).toContainText('עמודה א · עמודה ב · עמודה ג');
  await expect(homePage.emptyState).toBeVisible();
});

/* Exporting from an issuer's English interface produced English headings, which matched
   nothing and failed the whole file. */
test('imports a card report exported with English column names', async ({ homePage }) => {
  await homePage.upload.uploadCreditCardReport({
    name: 'card-en.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'Transaction Date,Merchant Name,Transaction Amount,Billing Amount',
      '03/08/2026,SHUFERSAL DEAL,431.00,431.00',
      '07/08/2026,AMAZON US,40.00,148.20',
    ].join('\n')),
  });

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'AMAZON US' })).toContainText('148.2');
});

/* The .xlsx path — zip, shared strings, styled date serials — was never driven from the
   browser, and it is the format the issuers' "download to Excel" produces most often. */
test('imports a credit-card report exported as .xlsx', async ({ homePage }) => {
  await homePage.upload.uploadCreditCardReport(xlsxCardReport());

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);
  await expect(homePage.dashboard.monthChips).toContainText('אוגוסט 2026');
});

/* Choosing several files at once is the ordinary way to load a year, and one bad file
   among them must not cost the customer the good ones. */
test('imports the readable files and explains the one it could not read', async ({ homePage }) => {
  await homePage.upload.creditCardInput.setInputFiles([
    issuerCardReport(),
    { name: 'mystery.csv', mimeType: 'text/csv', buffer: Buffer.from('עמודה א,עמודה ב\n1,2') },
  ]);

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.transactionRows).toHaveCount(4);
  await expect(homePage.toast).toContainText('4 תנועות נוספו');
  await expect(homePage.toast).toContainText('mystery.csv');
});

/* A file the reader cannot understand must leave the data already imported alone. */
test('keeps imported transactions when a later file is not recognised', async ({ homePage }) => {
  await homePage.upload.uploadCreditCardReport(issuerCardReport());
  await expect(homePage.dashboard.transactionRows).toHaveCount(4);

  await homePage.upload.creditCardInput.setInputFiles({
    name: 'broken.csv', mimeType: 'text/csv', buffer: Buffer.from('כותרת אחת\nערך'),
  });

  await expect(homePage.dashboard.transactionRows).toHaveCount(4);
  await expect(homePage.dashboard.root).toBeVisible();
});

/* Loading the same download twice is the most ordinary mistake there is; it must not
   double the month's spending. */
test('counts a re-imported card report as duplicates rather than doubling it', async ({ homePage }) => {
  await homePage.upload.uploadCreditCardReport(issuerCardReport());
  await expect(homePage.dashboard.transactionRows).toHaveCount(4);

  await homePage.upload.uploadCreditCardReport(issuerCardReport());

  await expect(homePage.toast).toContainText('4 תנועות כבר היו קיימות');
  await expect(homePage.dashboard.transactionRows).toHaveCount(4);
});

/* An import that succeeds and leaves every merchant name as replacement characters is
   worse than one that fails: the dashboard fills up and none of it can be categorised. */
test('keeps Hebrew merchant names when the card export is windows-1255', async ({ homePage }) => {
  await homePage.upload.uploadCreditCardReport(windows1255CardReport());

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'שופרסל דיל' })).toHaveCount(1);
  await expect(homePage.dashboard.transactionRows.first()).not.toContainText('\ufffd');
});

/* The cell reference is optional in the format, and a writer that omits it produced a
   workbook the reader turned into nothing — an empty report from a good file. */
test('imports an .xlsx written without cell references', async ({ homePage }) => {
  await homePage.upload.uploadCreditCardReport(xlsxCardReportWithoutReferences());

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'נטפליקס' })).toHaveCount(1);
});

/* The failure message is shown to whoever is looking at the screen, in their language. */
test('explains an unrecognised card layout in the interface language', async ({ homePage }) => {
  await homePage.language.choose('en');

  await homePage.upload.creditCardInput.setInputFiles({
    name: 'mystery.csv', mimeType: 'text/csv', buffer: Buffer.from('Column A,Column B\n1,2'),
  });

  await expect(homePage.toast).toContainText('mystery.csv');
  await expect(homePage.toast).toContainText('Column A · Column B');
});

/* Every earlier card fix was verified on the empty state; the header keeps its controls
   after an import too, and that is when the customer uses them again. */
test('keeps the upload labels whole after a report is imported', async ({ homePage, page }) => {
  await page.setViewportSize({ width: 348, height: 720 });
  await homePage.upload.uploadCreditCardReport(issuerCardReport());
  await expect(homePage.dashboard.root).toBeVisible();

  for (const trigger of [homePage.bankUploadTrigger, homePage.cardUploadTrigger]) {
    const cut = await trigger.locator('span').first()
      .evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    expect(cut).toBe(false);
  }
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

/* Leisure is discretionary spending, which is the part of a month a household can actually
   decide about — so it has to be separable from the bills it arrives beside. The ordering
   matters as much as the rules: הוט sells television next to the line the household pays
   for its internet, and a bill is not an evening out. */
test('separates leisure spending from the household bills it arrives beside', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'leisure.csv', mimeType: 'text/csv', buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,יתרה',
      '03/08/2026,נטפליקס,54.9,5000',
      '04/08/2026,מנוי חדר כושר הולמס פלייס,249,4751',
      '05/08/2026,מסעדת השף,180,4571',
      '06/08/2026,הוט - חבילת אינטרנט,129,4442',
      '07/08/2026,סינמה סיטי,72,4370',
    ].join('\n')),
  });

  await expect(homePage.dashboard.transactionCategories).toHaveCount(5);
  const categoryOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).getByTestId('transaction-category-select');

  for (const merchant of ['נטפליקס', 'הולמס פלייס', 'מסעדת השף', 'סינמה סיטי']) {
    await expect(categoryOf(merchant), `${merchant} is not leisure`).toHaveValue('leisure');
  }
  // The internet bill stays where the household budgets for it.
  await expect(categoryOf('הוט')).toHaveValue('home');
});

test('offers leisure as a category in every language', async ({ homePage }) => {
  await homePage.upload.uploadSampleBankReport();
  const picker = homePage.dashboard.transactionCategories.first();

  for (const [locale, name] of [['he', 'פנאי ובידור'], ['en', 'Leisure & entertainment'], ['fr', 'Loisirs et sorties']] as const) {
    await homePage.language.choose(locale);
    await expect(homePage.html).toHaveAttribute('lang', locale);
    await expect(picker.locator('option[value="leisure"]')).toHaveText(name);
  }
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
