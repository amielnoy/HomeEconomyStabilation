import { expect, test } from './fixtures';

/* What survives, what a customer can change, and the import path nobody tests because it
   has no button: the drop zone. The page listens for a drop anywhere on the document and
   the empty state invites it in words, so it is a first-class way in — and until now it was
   reachable only by a customer, never by a test. */

const bankReport = () => ({
  name: 'bank.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך,תיאור פעולה,חובה,זכות,יתרה',
    '02/08/2026,משכורת חודשית,,17400,20000',
    '05/08/2026,ארנונה עיריית חיפה,612,,19388',
    '09/08/2026,קפה נמרוד,38,,19350',
  ].join('\n')),
});

/* The File API is not scriptable from the page, so the drop is built the way the browser
   would deliver it: a DataTransfer carrying a real File, dispatched at the document. */
async function dropReport(page: import('@playwright/test').Page, name: string, content: string): Promise<void> {
  await page.evaluate(async ({ fileName, text }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], fileName, { type: 'text/csv' }));
    for (const type of ['dragenter', 'dragover', 'drop']) {
      document.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
    }
  }, { fileName: name, text: content });
}

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('imports a report dropped onto the page', async ({ homePage, page }) => {
  await expect(homePage.emptyState).toBeVisible();

  await dropReport(page, 'bank.csv', bankReport().buffer.toString('utf8'));

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.transactionRows).toHaveCount(3);
});

test('explains a dropped file it cannot read instead of failing silently', async ({ homePage, page }) => {
  await dropReport(page, 'mystery.csv', 'עמודה א,עמודה ב\n1,2');

  await expect(homePage.toast).toContainText('mystery.csv');
  await expect(homePage.emptyState).toBeVisible();
});

test('keeps the imported month after the page is reopened', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(bankReport());
  await expect(homePage.dashboard.transactionRows).toHaveCount(3);
  const before = await homePage.dashboard.readMonthlyOutflow();

  await homePage.reload();

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.transactionRows).toHaveCount(3);
  expect(await homePage.dashboard.readMonthlyOutflow()).toBe(before);
});

/* A category the customer corrects by hand must outrank every rule, for good — otherwise
   the correction is undone by the next render and they correct it again. */
test('keeps a corrected category after the page is reopened', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(bankReport());
  const row = homePage.dashboard.transactionRows.filter({ hasText: 'קפה נמרוד' });
  await row.getByTestId('transaction-category-select').selectOption('food');

  await homePage.reload();

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(
    homePage.dashboard.transactionRows.filter({ hasText: 'קפה נמרוד' }).getByTestId('transaction-category-select'),
  ).toHaveValue('food');
});

/* Rules are how a household stops correcting the same merchant every month. */
test('recategorises matching transactions when a rule is added', async ({ homePage, page }) => {
  await homePage.upload.uploadBankReport(bankReport());
  const coffee = homePage.dashboard.transactionRows.filter({ hasText: 'קפה נמרוד' });
  // A default rule already reads a cafe as leisure; the customer's own rule must outrank it.
  await expect(coffee.getByTestId('transaction-category-select')).toHaveValue('leisure');

  await homePage.settings.open();
  await page.getByTestId('settings-section-categories').locator('summary').click();
  await page.getByTestId('dr-addrule').click();
  // Added rules go to the front of the list, which is what lets them beat a default.
  const newRule = page.getByTestId('settings-rule-row').first();
  await newRule.getByTestId('rule-match-input').fill('קפה');
  await newRule.getByTestId('rule-category-select').selectOption('food');
  await homePage.settings.close();

  await expect(coffee.getByTestId('transaction-category-select')).toHaveValue('food');
});

test('keeps a saved rule after the page is reopened', async ({ homePage, page }) => {
  await homePage.upload.uploadBankReport(bankReport());
  await homePage.settings.open();
  await page.getByTestId('settings-section-categories').locator('summary').click();
  await page.getByTestId('dr-addrule').click();
  // Added rules go to the front of the list, which is what lets them beat a default.
  const newRule = page.getByTestId('settings-rule-row').first();
  await newRule.getByTestId('rule-match-input').fill('קפה');
  await newRule.getByTestId('rule-category-select').selectOption('food');
  await homePage.settings.close();

  await homePage.reload();

  await expect(
    homePage.dashboard.transactionRows.filter({ hasText: 'קפה נמרוד' }).getByTestId('transaction-category-select'),
  ).toHaveValue('food');
});

test('keeps a budget ceiling after the page is reopened', async ({ homePage, page }) => {
  await homePage.upload.uploadBankReport(bankReport());
  await homePage.settings.open();
  await page.getByTestId('settings-section-budgets').locator('summary').click();
  const homeBudget = page.getByTestId('settings-budget-row').filter({ hasText: 'דיור' }).getByTestId('budget-limit-input');
  await homeBudget.fill('900');
  await homeBudget.blur();
  await homePage.settings.close();

  await homePage.reload();
  await homePage.settings.open();
  await page.getByTestId('settings-section-budgets').locator('summary').click();

  await expect(page.getByTestId('settings-budget-row').filter({ hasText: 'דיור' }).getByTestId('budget-limit-input'))
    .toHaveValue('900');
});

/* The toast is the only place a result is reported, and it must clear itself — a message
   left over from an earlier action reads as the answer to the current one. */
test('clears the toast on its own', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(bankReport());

  await expect(homePage.toast).toHaveClass(/on/);
  await expect(homePage.toast).not.toHaveClass(/on/, { timeout: 10_000 });
});

test('returns from the recommendations screen to the dashboard', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(bankReport());
  await homePage.dashboard.openRecommendations();
  await expect(homePage.dashboard.recommendations).toBeVisible();

  await homePage.dashboard.openRecommendations();

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.transactionRows).toHaveCount(3);
});

/* Reading the dashboard at night is the same job as reading it by day. */
test('renders the dashboard in dark mode without losing the table', async ({ homePage, page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await homePage.upload.uploadBankReport(bankReport());

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.transactionRows).toHaveCount(3);
  const contrast = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    return { color: body.color, background: body.backgroundColor };
  });
  expect(contrast.color).not.toBe(contrast.background);
  expect(await homePage.hasHorizontalOverflow()).toBe(false);
});
