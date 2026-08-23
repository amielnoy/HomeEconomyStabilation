import type { FileChooser, Page } from '@playwright/test';
import { step } from '../step';

export interface MarketingAttribution {
  firstTouch: Record<string, string>;
  lastTouch: Record<string, string>;
}

export interface MarketingEvent {
  name: string;
  details: Record<string, string>;
}

export class MarketingComponent {
  readonly root = this.page.locator('#empty');
  readonly title = this.root.locator('h2').first();
  readonly primaryUpload = this.page.locator('#marketing-upload');
  readonly finalUpload = this.page.locator('#marketing-upload-final');
  readonly trustItems = this.page.locator('.marketing-trust li');
  readonly benefitCards = this.page.locator('.marketing-benefit-grid article');
  readonly preview = this.page.locator('.marketing-preview');

  constructor(private readonly page: Page) {}

  @step('Open the private file picker from the primary action')
  async openPrimaryFileChooser(): Promise<FileChooser> {
    const [chooser] = await Promise.all([
      this.page.waitForEvent('filechooser'),
      this.primaryUpload.click(),
    ]);
    return chooser;
  }

  @step('Read the saved campaign attribution')
  async readAttribution(): Promise<MarketingAttribution> {
    return this.readStorage('mazan-habait/marketing-attribution', null as unknown as MarketingAttribution);
  }

  @step('Read the saved marketing events')
  async readEvents(): Promise<MarketingEvent[]> {
    return this.readStorage('mazan-habait/marketing-events', []);
  }

  @step('Read the page background color')
  async bodyBackgroundColor(): Promise<string> {
    return this.page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor);
  }

  private async readStorage<T>(key: string, fallback: T): Promise<T> {
    return this.page.evaluate(
      ({ storageKey, defaultValue }) => {
        const value = localStorage.getItem(storageKey);
        return value === null ? defaultValue : JSON.parse(value);
      },
      { storageKey: key, defaultValue: fallback },
    );
  }
}
