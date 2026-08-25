import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { richBankReport } from './reports';
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
  /* A thin report leaves the savings, anomaly and recurring sections empty, so axe
     never reaches them. This one has the history every agent needs. */
  await homePage.upload.uploadBankReport(richBankReport());
  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.page.getByTestId('savings-opportunity').first()).toBeVisible();
  await expect(homePage.page.getByTestId('recurring-row').first()).toBeVisible();
  await expectNoSeriousAccessibilityViolations(homePage, 'populated French dashboard');

  await homePage.dashboard.categoryTableToggle.click();
  await expectNoSeriousAccessibilityViolations(homePage, 'category table view');
  await homePage.dashboard.categoryTableToggle.click();

  await homePage.settings.open();
  await expect(homePage.settings.root).toBeVisible();
  await expectNoSeriousAccessibilityViolations(homePage, 'settings dialog');
  await homePage.settings.close();

  await homePage.savingsDirectory.open();
  await expect(homePage.savingsDirectory.root).toBeVisible();
  await expectNoSeriousAccessibilityViolations(homePage, 'savings directory');
});

test('settings dialog traps keyboard focus and restores it to its opener', async ({ homePage }) => {
  const mobileMenuIsVisible = await homePage.mobileMenuToggle.isVisible();
  const expectedReturnTarget = mobileMenuIsVisible ? homePage.mobileMenuToggle : homePage.settings.openButton;

  await homePage.settings.open();
  await expect(homePage.settings.closeButton).toBeFocused();
  await homePage.page.keyboard.press('Shift+Tab');
  await expect(homePage.settings.root.locator(':focus')).toHaveCount(1);

  await homePage.page.keyboard.press('Escape');
  await expect(homePage.settings.root).not.toHaveClass(/\bon\b/);
  await expect(expectedReturnTarget).toBeFocused();
  await expect(homePage.settings.openButton).toHaveAttribute('aria-expanded', 'false');
});
