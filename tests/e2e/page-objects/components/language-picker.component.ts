import type { Page } from '@playwright/test';
import { step } from '../step';

export type SupportedLocale = 'he' | 'en' | 'am' | 'fr';

export class LanguagePickerComponent {
  readonly select = this.page.getByTestId('locale-select');
  readonly document = this.page.getByTestId('app-document');
  readonly productHeading = this.page.getByTestId('product-title');

  constructor(private readonly page: Page) {}

  @step('Switch the interface language')
  async choose(locale: SupportedLocale): Promise<void> {
    if (!await this.select.isVisible()) await this.page.getByTestId('mobile-menu-toggle').click();
    await this.select.selectOption(locale);
  }
}
