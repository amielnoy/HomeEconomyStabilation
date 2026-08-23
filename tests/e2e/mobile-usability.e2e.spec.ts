import { expect, test } from './fixtures';

test.describe('mobile browser usability', () => {
  test.skip(({ isMobile }) => !isMobile, 'Runs on the iOS and Android projects only');

  test.beforeEach(async ({ homePage }) => {
    await homePage.openFresh();
  });

  test('keeps primary controls readable, tappable and stable in every locale', async ({ homePage }) => {
    await expect(homePage.viewportMeta).toHaveAttribute('content', /viewport-fit=cover/);
    expect(await homePage.hasHorizontalOverflow()).toBe(false);

    for (const locale of ['he', 'en', 'am', 'fr'] as const) {
      await homePage.language.choose(locale);
      await expect(homePage.html).toHaveAttribute('lang', locale);
      expect(await homePage.hasHorizontalOverflow(), `${locale} should not overflow`).toBe(false);
      expect(
        await homePage.touchTargetsBelow(homePage.mobilePrimaryControls),
        `${locale} primary controls should be at least 44×44 CSS pixels`,
      ).toEqual([]);
    }

    const localeFontSize = await homePage.language.select.evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(localeFontSize).toBeGreaterThanOrEqual(16);

    const [bank, card, recommendations, savings] = await Promise.all([
      homePage.bankUploadTrigger.boundingBox(),
      homePage.cardUploadTrigger.boundingBox(),
      homePage.recommendationsTrigger.boundingBox(),
      homePage.savingsTrigger.boundingBox(),
    ]);
    expect(bank).not.toBeNull();
    expect(card).not.toBeNull();
    expect(recommendations).not.toBeNull();
    expect(savings).not.toBeNull();
    expect(bank!.width).toBeGreaterThan(card!.width * 1.8);
    expect(Math.abs(recommendations!.y - savings!.y)).toBeLessThan(1);
    expect(Math.abs(recommendations!.width - savings!.width)).toBeLessThan(1);
  });

  test('supports the complete import, recommendations, settings and directory journey', async ({ homePage }) => {
    await homePage.upload.uploadSampleBankReport();
    await expect(homePage.dashboard.root).toBeVisible();
    expect(await homePage.hasHorizontalOverflow()).toBe(false);
    expect(await homePage.touchTargetsBelow(homePage.mobileDashboardControls)).toEqual([]);

    await homePage.dashboard.openRecommendations();
    await expect(homePage.dashboard.recommendations).toBeVisible();
    await expect(homePage.dashboard.recommendationCards.first()).toBeVisible();

    await homePage.settings.open();
    await expect(homePage.settings.root).toBeVisible();
    const drawerBox = await homePage.settings.root.boundingBox();
    const viewport = homePage.page.viewportSize();
    expect(drawerBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(drawerBox!.x).toBeGreaterThanOrEqual(-0.5);
    expect(drawerBox!.width).toBeLessThanOrEqual(viewport!.width + 0.5);
    expect(await homePage.touchTargetsBelow(homePage.settings.formControls)).toEqual([]);
    await homePage.settings.close();

    await homePage.savingsDirectory.open();
    await expect(homePage.savingsDirectory.root).toBeVisible();
    await expect(homePage.savingsDirectory.cards).toHaveCount(15);
    expect(await homePage.hasHorizontalOverflow()).toBe(false);
    await homePage.savingsDirectory.goBack();
    await expect(homePage.dashboard.root).toBeVisible();
  });
});
