import { expect, test } from './fixtures';
import { richBankReport } from './reports';

/* Deliberately below the touch minimum. Each entry is an exemption someone has to
   justify, rather than a control that was quietly left out of a list. */
const TOUCH_TARGET_EXCEPTIONS = [
  // Wrapped by a full-width <label> that carries the tap area.
  '#cloud-consent-check',
  /* The upload controls are a <label class="btn"> wrapping the file input. The label is
     the 48px target; the input is visually hidden and exists to hold keyboard focus,
     because marking it `hidden` took the product's primary action out of the tab order
     altogether. Its own box is deliberately 1px. */
  '#file',
  '#card-file',
] as const;

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

  /* A phone at a large text size or zoom reports a viewport far narrower than the device
     is. Two upload labels plus the overflow toggle stopped fitting on one row there, and
     because the label is nowrap with nothing clipping it, "טעינת דוח כרטיס" spilled past
     the pill and off the screen as "טע" — the customer could not read what the control
     did. Every locale has to survive it, and the longest label is not the Hebrew one. */
  test('keeps both upload labels whole when zoom narrows the viewport', async ({ homePage, page }) => {
    await page.setViewportSize({ width: 280, height: 640 });

    for (const locale of ['he', 'en', 'am', 'fr'] as const) {
      await homePage.language.choose(locale);
      await expect(homePage.html).toHaveAttribute('lang', locale);
      expect(await homePage.hasHorizontalOverflow(), `${locale} should not overflow`).toBe(false);

      for (const trigger of [homePage.bankUploadTrigger, homePage.cardUploadTrigger]) {
        const label = trigger.locator('span').first();
        const overflow = await label.evaluate((element) => ({
          text: element.textContent ?? '',
          hidden: element.scrollWidth > element.clientWidth + 1,
        }));
        expect(overflow.hidden, `${locale}: "${overflow.text}" is cut off inside its button`).toBe(false);
      }

      const [bank, card] = await Promise.all([
        homePage.bankUploadTrigger.boundingBox(),
        homePage.cardUploadTrigger.boundingBox(),
      ]);
      // Each upload takes its own row here rather than being squeezed under its label.
      expect(card!.y).toBeGreaterThan(bank!.y + bank!.height - 1);
    }
  });

  test('supports the complete import, recommendations, settings and directory journey', async ({ homePage }) => {
    await homePage.upload.uploadSampleBankReport();
    await expect(homePage.dashboard.root).toBeVisible();
    expect(await homePage.hasHorizontalOverflow()).toBe(false);
    expect(await homePage.touchTargetsBelow(homePage.mobileDashboardControls)).toEqual([]);
    /* And every other interactive element, so a new control cannot slip in under the
       minimum just because nobody remembered to add it to a list. */
    expect(await homePage.undersizedTouchTargets({ exceptions: TOUCH_TARGET_EXCEPTIONS })).toEqual([]);
    const transactionTableRegion = homePage.page.getByTestId('tx-table-scroll');
    await expect(transactionTableRegion).toBeVisible();
    await expect(transactionTableRegion).toHaveAccessibleName('טבלת תנועות');
    await expect(transactionTableRegion).toHaveAttribute('tabindex', '0');
    /* The table used to be 558px inside a 346px scroller, which pushed the amount,
       balance and reference columns off-screen — the amount rendered as "4.90" where
       the value was "-54.90". The stacked layout must keep every amount fully inside
       the viewport with no horizontal scrolling at all. */
    expect(await homePage.dashboard.clippedTransactionAmounts()).toEqual([]);
    const tableScroll = await transactionTableRegion.evaluate(
      (node) => node.scrollWidth - node.clientWidth,
    );
    expect(tableScroll, 'the transactions table should not scroll sideways on a phone').toBeLessThanOrEqual(1);
    await expect(homePage.page.getByTestId('tx-scroll-hint')).toBeHidden();
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

  /* The empty state fits trivially. The dashboard is where a wide table can stretch the
     page: the category breakdown did exactly that in French, and a phone browser answers
     page-level overflow by zooming the whole interface out to fit. A table wider than the
     viewport has to scroll inside its own .tblwrap instead of taking the page with it. */
  test('keeps the populated dashboard within the viewport in every locale', async ({ homePage }) => {
    await homePage.upload.uploadBankReport(richBankReport());
    await expect(homePage.dashboard.root).toBeVisible();

    for (const locale of ['he', 'en', 'am', 'fr'] as const) {
      await homePage.language.choose(locale);
      await expect(homePage.html).toHaveAttribute('lang', locale);
      expect(
        await homePage.hasHorizontalOverflow(),
        `the ${locale} dashboard should fit the viewport`,
      ).toBe(false);

      await homePage.dashboard.categoryTableToggle.click();
      await expect(homePage.page.getByTestId('cat-table')).toBeVisible();
      expect(
        await homePage.hasHorizontalOverflow(),
        `the ${locale} category table should scroll inside its own region`,
      ).toBe(false);
      await homePage.dashboard.categoryTableToggle.click();
    }
  });
});
