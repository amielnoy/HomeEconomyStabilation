import type { Page } from '@playwright/test';
import { step } from '../step';

export class SavingsDirectoryComponent {
  readonly openButton = this.page.getByTestId('btn-savings');
  readonly root = this.page.getByTestId('savings-directory');
  readonly backButton = this.page.getByTestId('btn-directory-back');
  readonly cards = this.page.getByTestId('savings-directory-link');
  readonly officialToolsHeading = this.page.getByTestId('official-tools-h');
  readonly companiesHeading = this.page.getByTestId('companies-h');
  readonly title = this.page.getByTestId('directory-h');
  readonly disclaimer = this.page.getByTestId('directory-disclaimer');
  readonly externalLinks = this.page.getByTestId('savings-directory-link');

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
