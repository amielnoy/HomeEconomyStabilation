import type { Page } from '@playwright/test';
import { step } from '../step';

export class SavingsDirectoryComponent {
  readonly openButton = this.page.getByTestId('btn-savings');
  readonly root = this.page.getByTestId('savings-directory');
  readonly backButton = this.page.getByTestId('btn-directory-back');
  readonly paamonimLink = this.page.getByTestId('support-organization-paamonim-link');
  readonly mekimiLink = this.page.getByTestId('support-organization-mekimi-link');
  readonly paamonimWhatsAppLink = this.page.getByTestId('support-community-paamonim-whatsapp-link');
  readonly cards = this.page.getByTestId('savings-directory-link')
    .or(this.paamonimLink)
    .or(this.mekimiLink)
    .or(this.paamonimWhatsAppLink);
  readonly officialToolsHeading = this.page.getByTestId('official-tools-h');
  readonly supportOrganizationsHeading = this.page.getByTestId('support-organizations-h');
  readonly companiesHeading = this.page.getByTestId('companies-h');
  readonly title = this.page.getByTestId('directory-h');
  readonly disclaimer = this.page.getByTestId('directory-disclaimer');
  readonly externalLinks = this.cards;

  constructor(private readonly page: Page) {}

  @step('Open the savings and investments directory')
  async open(): Promise<void> {
    await this.openButton.click();
  }

  @step('Return from the savings directory')
  async goBack(): Promise<void> {
    await this.backButton.click();
  }

  @step('Verify support organizations appear before commercial providers')
  async supportOrganizationsComeBeforeCompanies(): Promise<boolean> {
    const companiesHeading = await this.companiesHeading.elementHandle();
    if (!companiesHeading) return false;
    return this.supportOrganizationsHeading.evaluate(
      (supportHeading, commercialHeading) => Boolean(
        supportHeading.compareDocumentPosition(commercialHeading) & Node.DOCUMENT_POSITION_FOLLOWING
      ),
      companiesHeading,
    );
  }
}
