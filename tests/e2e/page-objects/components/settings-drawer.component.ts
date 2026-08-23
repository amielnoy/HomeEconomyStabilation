import type { FilePayload, Page } from '@playwright/test';
import { step } from '../step';

export class SettingsDrawerComponent {
  readonly openButton = this.page.getByTestId('btn-set');
  readonly root = this.page.getByTestId('drawer');
  readonly closeButton = this.page.getByTestId('dr-close');
  readonly translatedContent = this.page.getByTestId('settings-translated-content');
  readonly backupInput = this.page.getByTestId('dr-import');
  readonly cloudConsent = this.page.getByTestId('cloud-consent');
  readonly cloudConsentCheck = this.page.getByTestId('cloud-consent-check');
  readonly cloudConsentLabel = this.page.getByTestId('cloud-consent-label');
  readonly cloudConsentAccept = this.page.getByTestId('cloud-consent-accept');
  readonly cloudConsentWithdraw = this.page.getByTestId('cloud-consent-withdraw');
  readonly cloudConsentStatus = this.page.getByTestId('cloud-consent-status');
  readonly dataSection = this.page.getByTestId('settings-section-data');
  readonly formControls = [
    this.closeButton, this.page.getByTestId('dr-addrule'), this.page.getByTestId('dr-addcat'),
    this.page.getByTestId('dr-export'), this.page.getByTestId('backup-import-trigger'), this.page.getByTestId('dr-wipe'),
    this.page.getByTestId('budget-limit-input'), this.page.getByTestId('rule-match-input'),
    this.page.getByTestId('rule-category-select'), this.page.getByTestId('delete-rule-button'),
    this.page.getByTestId('category-name-input'), this.page.getByTestId('category-type-select'),
    this.page.getByTestId('delete-category-button'), this.page.getByTestId('manual-date'),
    this.page.getByTestId('manual-desc'), this.page.getByTestId('manual-dir'), this.page.getByTestId('manual-amount'),
    this.page.getByTestId('manual-cat'), this.page.getByTestId('manual-submit'),
    this.cloudConsentLabel, this.cloudConsentAccept, this.cloudConsentWithdraw,
  ];

  constructor(private readonly page: Page) {}

  @step('Open the settings panel')
  async open(): Promise<void> {
    if (!await this.openButton.isVisible()) await this.page.getByTestId('mobile-menu-toggle').click();
    await this.openButton.click();
  }

  @step('Close the settings panel')
  async close(): Promise<void> {
    await this.closeButton.click();
  }

  @step('Import a saved backup')
  async importBackup(file: FilePayload): Promise<void> {
    await this.backupInput.setInputFiles(file);
  }

  @step('Open the data and privacy settings group')
  async openDataSection(): Promise<void> {
    if (!await this.dataSection.evaluate((element: HTMLDetailsElement) => element.open)) {
      await this.dataSection.locator('summary').click();
    }
  }

  @step('Read and accept the optional cloud-sync notice')
  async acceptCloudConsent(): Promise<void> {
    await this.openDataSection();
    await this.cloudConsentCheck.check();
    await this.cloudConsentAccept.click();
  }

  @step('Withdraw the optional cloud-sync consent')
  async withdrawCloudConsent(): Promise<void> {
    await this.openDataSection();
    await this.cloudConsentWithdraw.click();
  }
}
