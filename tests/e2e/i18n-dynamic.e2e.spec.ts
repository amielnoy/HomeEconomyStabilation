import { expect, test } from './fixtures';

const hebrew = /[א-ת]/;
test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
  await homePage.upload.uploadSampleBankReport();
  await expect(homePage.dashboard.root).toBeVisible();
});

for (const locale of ['en', 'fr', 'am'] as const) {
  test(`${locale} renders generated interface sentences without Hebrew leakage`, async ({ homePage }) => {
    await homePage.language.choose(locale);
    await expect(homePage.html).toHaveAttribute('lang', locale);

    for (const { selector, text } of await homePage.dashboard.dynamicRegionTexts()) {
      expect(text, `${selector} should be translated in ${locale}`).not.toMatch(hebrew);
      expect(text, `${selector} should not expose an i18n key`).not.toMatch(/\b(?:forecast|transaction|rec)[A-Z]\w+/);
      expect(text.trim(), `${selector} should contain useful text`).not.toBe('');
    }

    await homePage.settings.open();
    const translatedDrawerText = await homePage.settings.translatedContent.allInnerTexts();
    expect(translatedDrawerText.join(' ')).not.toMatch(hebrew);
    expect(translatedDrawerText.join(' ')).not.toMatch(/\{\w+\}/);
  });
}
