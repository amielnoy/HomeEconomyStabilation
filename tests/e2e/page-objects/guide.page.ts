import type { Page } from '@playwright/test';
import { BasePage } from './base.page';
import { step } from './step';

export class GuidePage extends BasePage {
  readonly title = this.page.getByRole('heading', { level: 1 });
  readonly english = this.page.getByRole('link', { name: 'English', exact: true });
  readonly hebrew = this.page.getByRole('link', { name: 'עברית', exact: true });

  constructor(page: Page) { super(page, '/guide.html'); }

  @step('Read the English translation')
  async switchToEnglish(): Promise<void> { await this.english.click(); }
}
