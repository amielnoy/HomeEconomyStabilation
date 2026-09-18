import { expect, test } from './fixtures';

/* Cash is the money a statement will never report, and recording it used to cost opening
   the drawer and finding a section inside it — so it went unrecorded, and every figure
   built on the month was short by however much the household spent in notes. The button is
   on the screen, and it leads to the screen that holds both the form and everything
   recorded through it. */

const statement = () => ({
  name: 'bank.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך,תיאור פעולה,חובה,זכות,יתרה',
    '02/09/2026,משכורת,,29000,29000',
  ].join('\n')),
});

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
  await homePage.upload.uploadBankReport(statement());
});

test('records a cash expense from the button on the screen', async ({ homePage }) => {
  await homePage.dashboard.quickAdd({ amount: 60, description: 'שוק מחנה יהודה' });

  const row = homePage.dashboard.transactionRows.filter({ hasText: 'שוק מחנה יהודה' });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('transaction-amount')).toContainText('-60.00');
  await expect(row.getByTestId('transaction-source')).toHaveText('הזנה ידנית');
});

/* The category the customer picked outranks any rule that would have claimed the
   description, exactly as choosing one on the row does. */
test('keeps the category the customer chose over the rule that would have claimed it', async ({ homePage }) => {
  await homePage.dashboard.quickAdd({ amount: 120, description: 'שופרסל דיל', category: 'leisure' });

  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'שופרסל דיל' })
    .getByTestId('transaction-category-select')).toHaveValue('leisure');
});

test('opens the expenses screen with the cursor in the amount and today filled in', async ({ homePage, page }) => {
  await homePage.dashboard.quickAddButton.click();

  await expect(page.getByTestId('expenses')).toBeVisible();
  await expect(page.getByTestId('btn-expenses')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('quick-amount')).toBeFocused();
  const today = new Date().toISOString().slice(0, 10);
  await expect(page.getByTestId('quick-date')).toHaveValue(today);
});

/* Money arriving is on a statement. The quick path is for the row that is not, and offering
   an income category here would invite a household to record its salary twice. */
test('offers only the categories money can leave through', async ({ homePage, page }) => {
  await homePage.dashboard.quickAddButton.click();

  await expect(page.getByTestId('quick-cat').locator('option[value="income"]')).toHaveCount(0);
  await expect(page.getByTestId('quick-cat')).toHaveValue('cash');
});

/* A form filled in and left is a form that recorded nothing, and going back must not
   quietly record it. */
test('adds nothing when the screen is left without saving', async ({ homePage, page }) => {
  const before = await homePage.dashboard.transactionRows.count();
  await homePage.dashboard.quickAddButton.click();
  await page.getByTestId('quick-amount').fill('60');
  await page.getByTestId('btn-expenses-back').click();

  await expect(homePage.dashboard.transactionRows).toHaveCount(before);
});

/* The form empties after a save: the same figures still on screen read as a charge that
   did not go in, and the next one is typed straight away. */
test('empties the form and keeps the cursor for the next one', async ({ homePage, page }) => {
  await homePage.dashboard.quickAdd({ amount: 60, description: 'שוק מחנה יהודה' });

  await expect(page.getByTestId('quick-amount')).toHaveValue('');
  await expect(page.getByTestId('quick-desc')).toHaveValue('');
  await expect(page.getByTestId('quick-amount')).toBeFocused();
});

/* What was recorded here is the household's own, so this screen lists it and can take one
   back out — which an imported row must never offer, being the bank's word. */
test('lists what was recorded here and takes one back out', async ({ homePage, page }) => {
  await homePage.dashboard.quickAdd({ amount: 60, description: 'שוק מחנה יהודה' });
  await expect(page.getByTestId('expense-row')).toHaveCount(1);
  await expect(page.getByTestId('expenses-note')).toContainText('60');

  await page.getByTestId('expense-remove').click();

  await expect(page.getByTestId('expense-row')).toHaveCount(0);
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'שוק מחנה יהודה' })).toHaveCount(0);
});

test('lists nothing a statement brought in', async ({ homePage, page }) => {
  await homePage.dashboard.quickAddButton.click();

  await expect(page.getByTestId('expense-row')).toHaveCount(0);
  await expect(page.getByTestId('expenses')).toContainText('עדיין לא נרשמו כאן הוצאות');
});

/* The same note recorded twice is the mistake this dialog makes easiest — it takes two
   taps — and a household's month must not grow by a charge that happened once. */
test('says so rather than recording the same cash expense twice', async ({ homePage }) => {
  await homePage.dashboard.quickAdd({ amount: 60, description: 'שוק מחנה יהודה' });
  await homePage.dashboard.quickAdd({ amount: 60, description: 'שוק מחנה יהודה' });

  await expect(homePage.toast).toContainText('כבר נרשמה');
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'שוק מחנה יהודה' })).toHaveCount(1);
});

test('refuses an amount that is not money', async ({ homePage, page }) => {
  const before = await homePage.dashboard.transactionRows.count();
  await homePage.dashboard.quickAddButton.click();
  await page.getByTestId('quick-amount').fill('0');
  await page.getByTestId('quick-desc').fill('כלום');
  await page.getByTestId('quick-submit').click();

  await expect(homePage.dashboard.transactionRows).toHaveCount(before);
});

test('offers the screen in every language', async ({ homePage, page }) => {
  for (const [locale, title] of [
    ['en', 'Manage expenses'], ['fr', 'Gestion des dépenses'], ['he', 'ניהול הוצאות'],
  ] as const) {
    await homePage.language.choose(locale);
    await homePage.dashboard.quickAddButton.click();
    await expect(page.getByTestId('expenses-h')).toHaveText(title);
    await page.getByTestId('btn-expenses-back').click();
  }
});
