import { expect, type Page } from '@playwright/test';
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
    /* Choosing a language reloads the page so dynamic copy is rebuilt from the
       canonical strings. Returning before that navigation lands leaves every
       following action racing it — an upload started too early is dropped with the
       old document, and the dashboard never appears. */
    await expect(this.document).toHaveAttribute('lang', locale);
    await expect(this.select).toHaveValue(locale);
  }
}
