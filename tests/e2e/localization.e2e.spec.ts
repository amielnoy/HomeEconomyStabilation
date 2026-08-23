import { expect, test } from './fixtures';

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('switches to French and preserves the choice after reload', async ({ homePage }) => {
  await homePage.language.choose('fr');

  await expect(homePage.html).toHaveAttribute('lang', 'fr');
  await expect(homePage.html).toHaveAttribute('dir', 'ltr');
  await expect(homePage.language.select).toHaveValue('fr');
  await expect(homePage.language.productHeading).toHaveText('Budget du foyer');

  await homePage.reload();
  await expect(homePage.language.select).toHaveValue('fr');
  await expect(homePage.language.productHeading).toHaveText('Budget du foyer');
});

test('switches cleanly between Hebrew RTL and Amharic LTR', async ({ homePage }) => {
  await expect(homePage.html).toHaveAttribute('dir', 'rtl');

  await homePage.language.choose('am');
  await expect(homePage.html).toHaveAttribute('lang', 'am');
  await expect(homePage.html).toHaveAttribute('dir', 'ltr');
  await expect(homePage.language.productHeading).toHaveText('የቤት በጀት');
  await expect(homePage.body).toHaveCSS('font-family', /Noto Sans Ethiopic/);

  await homePage.language.choose('he');
  await expect(homePage.html).toHaveAttribute('dir', 'rtl');
  await expect(homePage.language.productHeading).toHaveText('מאזן הבית');
});

test('keeps imported household amounts in shekels in French', async ({ homePage }) => {
  await homePage.language.choose('fr');
  await expect(homePage.html).toHaveAttribute('lang', 'fr');
  await homePage.upload.uploadSampleBankReport();

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.balance).toContainText('₪');
  await expect(homePage.dashboard.transactionRows.first().locator('td.n').nth(1)).toContainText('₪');
});

test('does not introduce horizontal page overflow on mobile in any language', async ({ homePage }) => {
  await homePage.useMobileViewport();

  for (const locale of ['he', 'en', 'am', 'fr'] as const) {
    await homePage.language.choose(locale);
    await expect(homePage.html).toHaveAttribute('lang', locale);
    const overflows = await homePage.hasHorizontalOverflow();
    expect(overflows, `${locale} should fit the mobile viewport`).toBe(false);
  }
});
