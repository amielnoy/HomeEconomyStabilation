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

/* Studies and clothing are the two lines a household plans for a year ahead and then meets
   monthly, and both used to land in "other" beside everything nobody had a rule for. The
   ordering carries as much as the rules: "שכר לימוד" would read as a salary against the
   income rule, and a school charged by the municipality would read as arnona. */
test('separates studies and clothing from the salary and the shops they arrive beside', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'studies-and-clothing.csv', mimeType: 'text/csv', buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,יתרה',
      '03/09/2026,אוניברסיטת תל אביב שכר לימוד,3200,9000',
      '04/09/2026,צהרון גן רימון,850,8150',
      '05/09/2026,קסטרו דיזנגוף סנטר,320,7830',
      '06/09/2026,נעלי גלי,240,7590',
      '07/09/2026,שופרסל דיל,410,7180',
    ].join('\n')),
  });

  await expect(homePage.dashboard.transactionCategories).toHaveCount(5);
  const categoryOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).getByTestId('transaction-category-select');

  // Tuition is an expense, not the salary the wording would otherwise match.
  await expect(categoryOf('אוניברסיטת תל אביב')).toHaveValue('education');
  await expect(categoryOf('צהרון')).toHaveValue('education');
  for (const merchant of ['קסטרו', 'נעלי גלי']) {
    await expect(categoryOf(merchant), `${merchant} is not clothing`).toHaveValue('clothing');
  }
  // The weekly shop stays where the household budgets for it.
  await expect(categoryOf('שופרסל')).toHaveValue('food');
});

/* The tax lines a household actually meets, each sitting next to a rule that would have
   claimed it: the authority is paid by transfer, מס שכר carries the salary wording, and a
   late assessment adds interest. Arnona is the deliberate exception that stays housing. */
test('separates tax payments from the transfers and bills they are worded like', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'taxes.csv', mimeType: 'text/csv', buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,יתרה',
      '03/09/2026,העברה לרשות המסים מקדמות מס,2400,9000',
      '04/09/2026,מס הכנסה ניכוי במקור,1800,7200',
      /* Quoted the way a real export writes it: the gershayim in מע"מ is a CSV quote too. */
      '05/09/2026,"תשלום מע""מ דו-חודשי",3100,4100',
      '06/09/2026,מס שכר,640,3460',
      '07/09/2026,ארנונה עיריית חיפה,780,2680',
      '08/09/2026,מסעדת הדגים,210,2470',
    ].join('\n')),
  });

  await expect(homePage.dashboard.transactionCategories).toHaveCount(6);
  const categoryOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).getByTestId('transaction-category-select');

  for (const merchant of ['רשות המסים', 'מס הכנסה', 'מע"מ', 'מס שכר']) {
    await expect(categoryOf(merchant), `${merchant} is not tax`).toHaveValue('tax');
  }
  // Arnona is a housing bill before it is a municipal tax, and מס never opens a restaurant.
  await expect(categoryOf('ארנונה')).toHaveValue('home');
  await expect(categoryOf('מסעדת')).toHaveValue('leisure');
});

/* A yeshiva's tuition is studies before it is religion, and a municipal charge is arnona
   before either, so both blocks stay above this one. */
test('separates Jewish life from the studies and bills it is worded like', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'judaism.csv', mimeType: 'text/csv', buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,יתרה',
      '03/09/2026,בית כנסת אהל יעקב דמי חבר,180,9000',
      '04/09/2026,תשמישי קדושה בני ברק,260,8740',
      '05/09/2026,תרומה צדקה קמחא דפסחא,300,8440',
      '06/09/2026,מקווה נשים,45,8395',
      '07/09/2026,אוניברסיטת תל אביב שכר לימוד,3200,5195',
      '08/09/2026,ארנונה עיריית חיפה,780,4415',
    ].join('\n')),
  });

  await expect(homePage.dashboard.transactionCategories).toHaveCount(6);
  const categoryOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).getByTestId('transaction-category-select');

  for (const merchant of ['בית כנסת', 'תשמישי קדושה', 'מקווה']) {
    await expect(categoryOf(merchant), `${merchant} is not judaism`).toHaveValue('judaism');
  }
  // Giving is its own line whoever it is given to, so tzedakah is not filed here.
  await expect(categoryOf('קמחא דפסחא')).toHaveValue('donations');
  await expect(categoryOf('אוניברסיטת')).toHaveValue('education');
  await expect(categoryOf('ארנונה')).toHaveValue('home');
});

/* Giving is one line in a household budget whoever it is given to, so tzedakah sits here
   and not with Jewish life, and a standing order to a charity must not read as a transfer. */
test('separates giving from the transfers and the synagogue it arrives beside', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'donations.csv', mimeType: 'text/csv', buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,יתרה',
      '03/09/2026,הוראת קבע עמותת ידידים,120,9000',
      '04/09/2026,תרומה עזר מציון,200,8800',
      '05/09/2026,צדקה מעשר כספים,350,8450',
      '06/09/2026,בית כנסת אהל יעקב דמי חבר,180,8270',
      '07/09/2026,העברה לחשבון חיסכון,1000,7270',
    ].join('\n')),
  });

  await expect(homePage.dashboard.transactionCategories).toHaveCount(5);
  const categoryOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).getByTestId('transaction-category-select');

  for (const merchant of ['ידידים', 'עזר מציון', 'צדקה']) {
    await expect(categoryOf(merchant), `${merchant} is not donations`).toHaveValue('donations');
  }
  // Synagogue dues stay Jewish life; an ordinary transfer stays savings.
  await expect(categoryOf('בית כנסת')).toHaveValue('judaism');
  await expect(categoryOf('העברה לחשבון')).toHaveValue('savings');
});

/* Every category the defaults gained after launch, in one pass. Each used to carry its own
   near-identical copy of this test, so a new category was covered only if whoever added it
   remembered to clone one more — and the clone read the same three locales all over again. */
/* Connectivity is the household's bill and streaming is an evening in; neither becomes
   computing because a technology company sent the charge. */
test('separates computing from the connectivity and streaming it arrives beside', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'computing.csv', mimeType: 'text/csv', buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,יתרה',
      '03/09/2026,KSP מחשבים ותקשורת,4200,9000',
      '04/09/2026,ADOBE CREATIVE CLOUD,180,8820',
      '05/09/2026,GOOGLE STORAGE,45,8775',
      '06/09/2026,בזק בינלאומי אינטרנט,120,8655',
      '07/09/2026,נטפליקס,55,8600',
    ].join('\n')),
  });

  await expect(homePage.dashboard.transactionCategories).toHaveCount(5);
  const categoryOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).getByTestId('transaction-category-select');

  for (const merchant of ['KSP', 'ADOBE', 'GOOGLE']) {
    await expect(categoryOf(merchant), `${merchant} is not computing`).toHaveValue('computing');
  }
  await expect(categoryOf('בזק')).toHaveValue('home');
  await expect(categoryOf('נטפליקס')).toHaveValue('leisure');
});

test('offers every added category in every language', async ({ homePage }) => {
  await homePage.upload.uploadSampleBankReport();
  const picker = homePage.dashboard.transactionCategories.first();

  const names = {
    loans:     { he: 'הלוואות', en: 'Loans', fr: 'Prêts' },
    leisure:   { he: 'פנאי ובידור', en: 'Leisure & entertainment', fr: 'Loisirs et sorties' },
    education: { he: 'לימודים וחינוך', en: 'Education & schooling', fr: 'Études et scolarité' },
    clothing:  { he: 'ביגוד והנעלה', en: 'Clothing & footwear', fr: 'Vêtements et chaussures' },
    tax:       { he: 'מיסים', en: 'Taxes', fr: 'Impôts' },
    judaism:   { he: 'יהדות', en: 'Judaism', fr: 'Judaïsme' },
    donations: { he: 'תרומות', en: 'Donations', fr: 'Dons' },
    computing: { he: 'מחשוב', en: 'Computing & software', fr: 'Informatique' },
  } as const;

  for (const locale of ['he', 'en', 'fr'] as const) {
    await homePage.language.choose(locale);
    await expect(homePage.html).toHaveAttribute('lang', locale);
    for (const [id, byLocale] of Object.entries(names)) {
      await expect(picker.locator(`option[value="${id}"]`), `${id} in ${locale}`).toHaveText(byLocale[locale]);
    }
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
