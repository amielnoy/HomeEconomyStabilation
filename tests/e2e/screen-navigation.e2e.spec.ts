import { expect, test } from './fixtures';

/* The screens were four buttons among the actions, and on a phone that meant behind the
   overflow toggle: a household that had not opened that menu did not know they existed.
   They are a named bar now, one line, every width. */

const statement = () => ({
  name: 'bank.csv', mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך,תיאור פעולה,חובה,זכות,יתרה',
    '02/09/2026,משכורת,,29000,29000',
    '03/09/2026,ארנונה עיריית חיפה,1240,,27760',
  ].join('\n')),
});

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
  await homePage.upload.uploadBankReport(statement());
});

test('names every screen without opening a menu', async ({ page }) => {
  for (const testId of ['btn-overview', 'btn-cards', 'btn-goals', 'btn-recommendations', 'btn-savings']) {
    await expect(page.getByTestId(testId)).toBeVisible();
  }
});

/* The tab a household is on has to be obvious from the bar without counting colours. */
test('marks the screen the reader is on, and only that one', async ({ page }) => {
  await expect(page.getByTestId('btn-overview')).toHaveAttribute('aria-current', 'page');

  await page.getByTestId('btn-cards').click();

  await expect(page.getByTestId('btn-cards')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('btn-overview')).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('btn-goals')).not.toHaveAttribute('aria-current', 'page');
});

test('carries the reader between screens and back to the dashboard', async ({ page }) => {
  await page.getByTestId('btn-goals').click();
  await expect(page.getByTestId('goals')).toBeVisible();

  await page.getByTestId('btn-cards').click();
  await expect(page.getByTestId('cards')).toBeVisible();
  await expect(page.getByTestId('goals')).toBeHidden();

  await page.getByTestId('btn-overview').click();
  await expect(page.getByTestId('main')).toBeVisible();
  await expect(page.getByTestId('cards')).toBeHidden();
  await expect(page.getByTestId('btn-overview')).toHaveAttribute('aria-current', 'page');
});

/* One line at every width: a bar that wrapped would cost the page a row on the screen
   with the least of it to spare. */
test('stays one line on a phone and scrolls instead of wrapping', async ({ homePage, page }) => {
  await homePage.useMobileViewport();

  const nav = page.getByTestId('screen-nav');
  const box = await nav.boundingBox();
  const tab = await page.getByTestId('btn-overview').boundingBox();
  expect(box!.height, 'the navigation wrapped onto a second row').toBeLessThan(tab!.height * 1.6);
  expect(await homePage.hasHorizontalOverflow(), 'the bar pushed the page sideways').toBe(false);
});

test('offers the screens in every language', async ({ homePage, page }) => {
  for (const [locale, overview] of [
    ['en', 'Overview'], ['fr', 'Vue d’ensemble'], ['he', 'תמונת מצב'],
  ] as const) {
    await homePage.language.choose(locale);
    await expect(page.getByTestId('btn-overview')).toHaveText(overview);
  }
});

/* The chips above choose the month the dashboard is on, and the transactions table is
   where people arrive with a month in mind — sending them back up to the chips to say
   which was a step nobody should have to take. */
test.describe('choosing a month', () => {
  const twoMonths = () => ({
    name: 'bank.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,זכות,יתרה',
      '02/08/2026,משכורת,,29000,29000',
      '03/08/2026,ארנונה עיריית חיפה,1240,,27760',
      '02/09/2026,משכורת,,29000,56760',
      '05/09/2026,שופרסל דיל,412.30,,56348',
    ].join('\n')),
  });

  test('names every month the household has, and all of them together', async ({ homePage, page }) => {
    await homePage.openFresh();
    await homePage.upload.uploadBankReport(twoMonths());

    await expect(page.getByTestId('f-scope').locator('option'))
      .toHaveText(['ספטמבר 2026', 'אוגוסט 2026', 'כל ההיסטוריה']);
    await expect(page.getByTestId('f-scope')).toHaveValue('2026-09');
  });

  test('shows the month that was chosen', async ({ homePage, page }) => {
    await homePage.openFresh();
    await homePage.upload.uploadBankReport(twoMonths());

    await page.getByTestId('f-scope').selectOption('2026-08');

    await expect(homePage.dashboard.transactionRows).toHaveCount(2);
    await expect(homePage.dashboard.transactionRows.filter({ hasText: 'ארנונה' })).toHaveCount(1);
    await expect(homePage.dashboard.transactionRows.filter({ hasText: 'שופרסל' })).toHaveCount(0);
  });

  /* Two controls disagreeing about which month is open is worse than one extra list. */
  test('moves the rest of the dashboard to the month it was given', async ({ homePage, page }) => {
    await homePage.openFresh();
    await homePage.upload.uploadBankReport(twoMonths());

    await page.getByTestId('f-scope').selectOption('2026-08');

    await expect(homePage.dashboard.monthChips.filter({ hasText: 'אוגוסט' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  test('keeps all history to the table that asked for it', async ({ homePage, page }) => {
    await homePage.openFresh();
    await homePage.upload.uploadBankReport(twoMonths());

    await page.getByTestId('f-scope').selectOption('all');

    await expect(homePage.dashboard.transactionRows).toHaveCount(4);
    await expect(homePage.dashboard.monthChips.filter({ hasText: 'ספטמבר' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  test('offers the same list on the credit cards screen', async ({ homePage, page }) => {
    await homePage.openFresh();
    await homePage.upload.uploadBankReport(twoMonths());
    await homePage.dashboard.openCards();

    await expect(page.getByTestId('f-card-scope').locator('option'))
      .toHaveText(['ספטמבר 2026', 'אוגוסט 2026', 'כל ההיסטוריה']);
  });
});
