import type { Page } from '@playwright/test';
import { step } from '../step';

export type SupportedLocale = 'he' | 'en' | 'am' | 'fr';

export class LanguagePickerComponent {
  readonly select = this.page.locator('#locale-select');
  readonly document = this.page.locator('html');
  readonly productHeading = this.page.locator('h1');

  constructor(private readonly page: Page) {}

  @step('Switch the interface language')
  async choose(locale: SupportedLocale): Promise<void> {
    await this.select.selectOption(locale);
  }
}
