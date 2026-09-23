import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

test.describe('crawler-readable guides', () => {
  test.use({ javaScriptEnabled: false });
  test('reads both languages without JavaScript', async ({ guidePage, page }) => {
    await guidePage.open();
    await expect(guidePage.title).toContainText('מאזן הבית');
    expect(await guidePage.hasHorizontalOverflow()).toBe(false);
    expect(await guidePage.undersizedTouchTargets({ minimumSize: 48 })).toEqual([]);
    await guidePage.switchToEnglish();
    await expect(guidePage.title).toContainText('Mazan Habait');
    await expect(page.getByRole('heading', { name: 'Are my finances sent to the cloud?' })).toBeVisible();
    expect(await guidePage.hasHorizontalOverflow()).toBe(false);
  });
});

// Axe itself needs JavaScript, independently of whether the page needs it.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`guides are accessible in ${colorScheme} mode`, async ({ guidePage, page }) => {
    await page.emulateMedia({ colorScheme });
    await guidePage.open();
    for (const language of ['he', 'en']) {
      if (language === 'en') await guidePage.switchToEnglish();
      expect(await guidePage.hasHorizontalOverflow()).toBe(false);
      expect(await guidePage.undersizedTouchTargets({ minimumSize: 48 })).toEqual([]);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
    }
  });
}
