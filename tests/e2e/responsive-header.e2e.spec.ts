import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import { issuerCardReport } from './reports';

/* The header was measured at device widths only, and every device in the matrix is wide
   enough to hide the defect. What a customer actually reports is a viewport narrowed by
   zoom or by a large system text size — the same CSS pixels, arrived at differently. The
   widths below walk that band, where two upload labels, an overflow toggle and four
   translations have to share a row that stops being wide enough partway down. */

const NARROW = { width: 280, height: 640 };

/* A label wider than the box drawn around it is the defect, so the measurement is the
   label's own overflow rather than anything about the page. */
const labelOverflow = (trigger: Locator) => trigger.locator('span').first().evaluate((element) => ({
  text: element.textContent ?? '',
  cut: element.scrollWidth > element.clientWidth + 1,
}));

test.describe('header at narrowed viewports', () => {
  test.beforeEach(async ({ homePage }) => {
    await homePage.openFresh();
  });

  for (const width of [280, 300, 320, 340, 360, 430]) {
    test(`fits the header without overflow at ${width}px`, async ({ homePage, page }) => {
      await page.setViewportSize({ width, height: 720 });

      expect(await homePage.hasHorizontalOverflow(), `${width}px overflows sideways`).toBe(false);

      for (const trigger of [homePage.bankUploadTrigger, homePage.cardUploadTrigger]) {
        const label = await labelOverflow(trigger);
        expect(label.cut, `"${label.text}" is cut off at ${width}px`).toBe(false);
      }
    });
  }

  /* Sampling a handful of widths in Hebrew is what let this through the first time: the
     band where the label no longer fits runs from 345px to 400px in English and to 490px
     in French — every ordinary phone — and none of the sampled widths landed in it. The
     whole band is walked in every language instead, because the width at which a label
     stops fitting is a property of the translation, not of the layout. */
  test('never cuts an upload label at any width in any language', async ({ homePage, page }) => {
    for (const locale of ['he', 'en', 'am', 'fr'] as const) {
      await page.setViewportSize({ width: 800, height: 720 });
      await homePage.language.choose(locale);

      const cut: number[] = [];
      for (let width = 240; width <= 600; width += 10) {
        await page.setViewportSize({ width, height: 720 });
        const clipped = await page.evaluate(() => ['bank-upload-trigger', 'card-upload-trigger'].some((id) => {
          const element = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
          const label = element.querySelector('span') as HTMLElement;
          return element.scrollWidth > element.clientWidth + 1
            || label.scrollWidth > label.clientWidth + 1;
        }));
        if (clipped) cut.push(width);
      }

      expect(cut, `${locale} cuts an upload label at these widths`).toEqual([]);
    }
  });

  /* Below the width where both labels fit side by side each upload takes its own row;
     above it they share one. Getting this backwards is what produced "טע". */
  test('stacks the uploads only once they stop fitting side by side', async ({ homePage, page }) => {
    await page.setViewportSize(NARROW);
    const stacked = await Promise.all([
      homePage.bankUploadTrigger.boundingBox(), homePage.cardUploadTrigger.boundingBox(),
    ]);
    expect(stacked[1]!.y).toBeGreaterThan(stacked[0]!.y + stacked[0]!.height - 1);

    await page.setViewportSize({ width: 390, height: 720 });
    const sideBySide = await Promise.all([
      homePage.bankUploadTrigger.boundingBox(), homePage.cardUploadTrigger.boundingBox(),
    ]);
    expect(Math.abs(sideBySide[0]!.y - sideBySide[1]!.y)).toBeLessThan(1);
  });

  test('keeps both uploads tappable when the header stacks', async ({ homePage, page }) => {
    await page.setViewportSize(NARROW);

    expect(await homePage.touchTargetsBelow([
      homePage.bankUploadTrigger, homePage.cardUploadTrigger, homePage.mobileMenuToggle,
    ])).toEqual([]);
  });

  test('keeps the overflow menu reachable and inside the viewport when stacked', async ({ homePage, page }) => {
    await page.setViewportSize(NARROW);

    await homePage.mobileMenuToggle.click();

    await expect(homePage.secondaryActions).toBeVisible();
    expect(await homePage.hasHorizontalOverflow(), 'the open menu overflows sideways').toBe(false);
    const menu = await homePage.secondaryActions.boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(-0.5);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(NARROW.width + 0.5);
  });

  /* The longest translation is not the Hebrew one, and the layout is authored against
     the Hebrew one. */
  test('keeps every locale readable at the narrowest width', async ({ homePage, page }) => {
    await page.setViewportSize(NARROW);

    for (const locale of ['he', 'en', 'am', 'fr'] as const) {
      await homePage.language.choose(locale);
      await expect(homePage.html).toHaveAttribute('lang', locale);

      expect(await homePage.hasHorizontalOverflow(), `${locale} overflows sideways`).toBe(false);
      for (const trigger of [homePage.bankUploadTrigger, homePage.cardUploadTrigger]) {
        const label = await labelOverflow(trigger);
        expect(label.cut, `${locale}: "${label.text}" is cut off`).toBe(false);
        expect(label.text.trim(), `${locale} rendered an empty label`).not.toBe('');
      }
    }
  });

  /* WCAG reflow: 1280px at 400% zoom is a 320px viewport, and no content may be lost. */
  test('loses no header content at the reflow width', async ({ homePage, page }) => {
    await page.setViewportSize({ width: 320, height: 256 });

    await expect(homePage.bankUploadTrigger).toBeVisible();
    await expect(homePage.cardUploadTrigger).toBeVisible();
    await expect(homePage.mobileMenuToggle).toBeVisible();
    expect(await homePage.hasHorizontalOverflow()).toBe(false);
  });

  test('imports a card report from the stacked header', async ({ homePage, page }) => {
    await page.setViewportSize(NARROW);

    await homePage.upload.uploadCreditCardReport(issuerCardReport());

    await expect(homePage.dashboard.root).toBeVisible();
    await expect(homePage.dashboard.transactionRows).toHaveCount(4);
    expect(await homePage.hasHorizontalOverflow(), 'the dashboard overflows at 280px').toBe(false);
  });

  /* The failure message names a file and lists columns, so it is the longest string the
     product ever shows — and it appears exactly when the customer is already stuck. */
  test('keeps the import failure message inside the viewport when stacked', async ({ homePage, page }) => {
    await page.setViewportSize(NARROW);

    await homePage.upload.creditCardInput.setInputFiles({
      name: 'card-statement-august-2026.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('עמודה ראשונה,שם בית העסק ומיקומו,סכום ומטבע\n1,2,3'),
    });

    await expect(homePage.toast).toContainText('card-statement-august-2026.csv');
    const toast = await homePage.toast.boundingBox();
    expect(toast!.x).toBeGreaterThanOrEqual(-0.5);
    expect(toast!.x + toast!.width).toBeLessThanOrEqual(NARROW.width + 0.5);
    expect(await homePage.hasHorizontalOverflow()).toBe(false);
  });

  /* The control is a label wrapping a file input, and a label cannot hold focus. Marking
     that input `hidden` took it out of the tab order, so the product's primary action —
     and the card upload, which has no other affordance once the empty state is gone —
     could not be reached from a keyboard at all. */
  test('places both uploads in the tab order', async ({ homePage, page, isMobile }) => {
    /* WebKit on iOS does not move focus with Tab at all unless full keyboard access is
       switched on, so pressing it there measures the platform rather than this header.
       Focusability itself is still asserted on every project by the two tests below. */
    test.skip(!!isMobile, 'Tab navigation is a desktop-keyboard behaviour');
    await page.setViewportSize(NARROW);
    await page.evaluate(() => (document.body as HTMLElement).focus());

    const reached: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press('Tab');
      reached.push(await page.evaluate(() => (document.activeElement as HTMLElement).id));
    }

    expect(reached).toContain('file');
    expect(reached).toContain('card-file');
  });

  test('shows the focus ring on the pill the focused upload lives in', async ({ homePage, page }) => {
    await page.setViewportSize(NARROW);

    await homePage.upload.creditCardInput.focus();

    await expect(homePage.upload.creditCardInput).toBeFocused();
    const outlineWidth = await homePage.cardUploadTrigger.evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).outlineWidth),
    );
    expect(outlineWidth, 'the focused upload shows no ring on its pill').toBeGreaterThan(0);
  });

  /* Keeping the input in the tab order must not make it visible: two file inputs drawn
     next to the pills would be the same defect from the other side. */
  test('keeps the focusable file inputs out of sight', async ({ homePage, page }) => {
    await page.setViewportSize(NARROW);

    for (const input of [homePage.upload.bankReportInput, homePage.upload.creditCardInput]) {
      const box = await input.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(2);
      expect(box!.height).toBeLessThanOrEqual(2);
    }
    expect(await homePage.hasHorizontalOverflow()).toBe(false);
  });

  /* Landscape on a small phone is the same narrow width with almost no height, where a
     header that grew a row can push the page's own content off the screen. */
  test('leaves room for the page below a stacked header', async ({ homePage, page }) => {
    await page.setViewportSize({ width: 280, height: 400 });

    const header = await homePage.header.boundingBox();
    expect(header!.height, 'the header eats the viewport').toBeLessThan(240);
    await expect(homePage.emptyState).toBeVisible();
  });
});
