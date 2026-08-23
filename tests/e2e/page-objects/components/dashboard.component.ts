import type { Page } from '@playwright/test';
import { step } from '../step';

export class DashboardComponent {
  readonly root = this.page.locator('#main');
  readonly monthChips = this.page.locator('#months .mchip');
  readonly transactionRows = this.page.locator('#tx-body tr');
  readonly accountSummary = this.page.locator('#acct');
  readonly balance = this.page.locator('#t-bal');
  readonly recommendationButton = this.page.locator('#btn-recommendations');
  readonly recommendations = this.page.locator('#recommendations');
  readonly recommendationNote = this.page.locator('#rec-screen-note');
  readonly recommendationCards = this.page.locator('.recommendation');
  readonly forecastChart = this.page.locator('#fc');
  readonly forecastTooltip = this.page.locator('#fc-tip');
  readonly dynamicRegions = [
    '#fc-note', '#bd-note', '#cat-note', '#rc-note', '#tx-count', '#foot-note', '#attention',
  ].map((selector) => this.page.locator(selector));

  constructor(private readonly page: Page) {}

  @step('Open the recommendations')
  async openRecommendations(): Promise<void> {
    await this.recommendationButton.click();
  }

  @step('Read the generated dashboard messages')
  async dynamicRegionTexts(): Promise<Array<{ selector: string; text: string }>> {
    const selectors = [
      '#fc-note', '#bd-note', '#cat-note', '#rc-note', '#tx-count', '#foot-note', '#attention',
    ];
    return Promise.all(selectors.map(async (selector) => ({
      selector,
      text: await this.page.locator(selector).innerText(),
    })));
  }

  @step('Find the expected text in the forecast tooltip')
  async findForecastTooltipText(expected: string): Promise<boolean> {
    return this.page.evaluate((text) => {
      const svg = document.querySelector<SVGSVGElement>('#fc')!;
      const hit = svg.querySelector<SVGRectElement>('rect[fill="transparent"]')!;
      const bounds = svg.getBoundingClientRect();
      for (let step = 0; step <= 120; step += 1) {
        hit.dispatchEvent(new PointerEvent('pointermove', {
          clientX: bounds.left + (bounds.width * step) / 120,
          clientY: bounds.top + 50,
          bubbles: true,
        }));
        if (document.querySelector('#fc-tip')?.textContent?.includes(text)) return true;
      }
      return false;
    }, expected);
  }
}
