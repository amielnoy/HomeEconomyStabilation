import type { Locator, Page } from '@playwright/test';
import { step } from './step';

export abstract class BasePage {
  readonly html = this.page.getByTestId('app-document');
  readonly body = this.page.getByTestId('app-body');
  readonly viewportMeta = this.page.getByTestId('viewport-meta');

  protected constructor(
    public readonly page: Page,
    private readonly path: string,
  ) {}

  @step('Open the page')
  async open(query = ''): Promise<void> {
    await this.page.goto(`${this.path}${query}`);
  }

  @step('Open a fresh page with cleared browser data')
  async openFresh(query = ''): Promise<void> {
    await this.open(query);
    await this.clearLocalStorage();
    await this.page.reload();
  }

  @step('Reload the page')
  async reload(): Promise<void> {
    await this.page.reload();
  }

  @step('Clear saved browser data')
  async clearLocalStorage(): Promise<void> {
    await this.page.evaluate(() => localStorage.clear());
  }

  @step('Resize the page to a mobile screen')
  async useMobileViewport(): Promise<void> {
    await this.page.setViewportSize({ width: 390, height: 844 });
  }

  @step('Check for horizontal page overflow')
  async hasHorizontalOverflow(): Promise<boolean> {
    return this.page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
  }

  @step('Check that visible touch targets are large enough')
  async touchTargetsBelow(locator: Locator | readonly Locator[], minimumSize = 44): Promise<Array<{
    label: string;
    width: number;
    height: number;
  }>> {
    const locators = Array.isArray(locator) ? locator : [locator];
    const targets = (await Promise.all(locators.map((item) => item.all()))).flat();
    const undersized = [];
    for (const target of targets) {
      if (!await target.isVisible()) continue;
      const box = await target.boundingBox();
      if (!box || (box.width >= minimumSize && box.height >= minimumSize)) continue;
      undersized.push({
        label: (await target.getAttribute('aria-label'))
          ?? (await target.innerText()).trim().slice(0, 80)
          ?? '<unlabelled>',
        width: Math.round(box.width),
        height: Math.round(box.height),
      });
    }
    return undersized;
  }

}
