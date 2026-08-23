import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import type { BasePage } from './page-objects/base.page';

async function expectNoSeriousAccessibilityViolations(pageObject: BasePage, context: string) {
  const results = await new AxeBuilder({ page: pageObject.page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
  expect(violations, context).toEqual([]);
}

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('empty state and language controls meet WCAG A/AA checks', async ({ homePage }) => {
  await expectNoSeriousAccessibilityViolations(homePage, 'empty dashboard');

  await homePage.language.choose('am');
  await expect(homePage.html).toHaveAttribute('lang', 'am');
  await expectNoSeriousAccessibilityViolations(homePage, 'Amharic empty dashboard');
});

test('data dashboard, settings dialog and savings directory meet WCAG A/AA checks', async ({ homePage }) => {
  await homePage.language.choose('fr');
  await homePage.upload.uploadSampleBankReport();
  await expect(homePage.dashboard.root).toBeVisible();
  await expectNoSeriousAccessibilityViolations(homePage, 'populated French dashboard');

  await homePage.settings.open();
  await expect(homePage.settings.root).toBeVisible();
  await expectNoSeriousAccessibilityViolations(homePage, 'settings dialog');
  await homePage.settings.close();

  await homePage.savingsDirectory.open();
  await expect(homePage.savingsDirectory.root).toBeVisible();
  await expectNoSeriousAccessibilityViolations(homePage, 'savings directory');
});
