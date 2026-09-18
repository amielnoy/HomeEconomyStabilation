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
