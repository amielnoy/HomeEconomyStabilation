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

    const [header, bank, card, menu] = await Promise.all([
      homePage.header.boundingBox(),
      homePage.bankUploadTrigger.boundingBox(),
      homePage.cardUploadTrigger.boundingBox(),
      homePage.mobileMenuToggle.boundingBox(),
    ]);
    expect(header).not.toBeNull();
    expect(bank).not.toBeNull();
    expect(card).not.toBeNull();
    expect(menu).not.toBeNull();
    expect(header!.height).toBeLessThan(180);
    expect(Math.abs(bank!.y - card!.y)).toBeLessThan(1);
    expect(Math.abs(bank!.y - menu!.y)).toBeLessThan(1);

    await homePage.mobileMenuToggle.click();
    await expect(homePage.secondaryActions).toBeVisible();
    expect(await homePage.touchTargetsBelow(homePage.mobileSecondaryControls)).toEqual([]);
  });

  test('supports the complete import, recommendations, settings and directory journey', async ({ homePage }) => {
    await homePage.upload.uploadSampleBankReport();
    await expect(homePage.dashboard.root).toBeVisible();
    expect(await homePage.hasHorizontalOverflow()).toBe(false);
    expect(await homePage.touchTargetsBelow(homePage.mobileDashboardControls)).toEqual([]);
    const [guide, amount, months] = await Promise.all([
      homePage.dashboard.spendingGuide.boundingBox(),
      homePage.dashboard.spendingGuideAmount.boundingBox(),
      homePage.page.getByTestId('months').boundingBox(),
    ]);
    expect(guide).not.toBeNull();
    expect(amount).not.toBeNull();
    expect(months).not.toBeNull();
    expect(guide!.y).toBeLessThan(months!.y);
    expect(amount!.y + amount!.height).toBeLessThan(homePage.page.viewportSize()!.height);

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
    await expect(homePage.savingsDirectory.cards).toHaveCount(18);
    expect(await homePage.hasHorizontalOverflow()).toBe(false);
    await homePage.savingsDirectory.goBack();
    await expect(homePage.dashboard.root).toBeVisible();
  });
});
