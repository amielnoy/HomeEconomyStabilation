import type { Page } from '@playwright/test';
import { step } from '../step';

export class SavingsDirectoryComponent {
  readonly openButton = this.page.locator('#btn-savings');
  readonly root = this.page.locator('#savings-directory');
  readonly backButton = this.page.locator('#btn-directory-back');
  readonly cards = this.root.locator('.ds-link-card');
  readonly officialToolsHeading = this.page.locator('#official-tools-h');
  readonly companiesHeading = this.page.locator('#companies-h');
  readonly title = this.page.locator('#directory-h');
  readonly disclaimer = this.page.locator('[data-i18n="directoryDisclaimer"]');
  readonly externalLinks = this.root.locator('a[target="_blank"]');

  constructor(private readonly page: Page) {}

  @step('Open the savings and investments directory')
  async open(): Promise<void> {
    await this.openButton.click();
  }

  @step('Return from the savings directory')
  async goBack(): Promise<void> {
    await this.backButton.click();
  }
}
