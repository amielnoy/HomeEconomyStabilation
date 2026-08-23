import type { FilePayload, Page } from '@playwright/test';
import { step } from '../step';

export class SettingsDrawerComponent {
  readonly openButton = this.page.getByTestId('btn-set');
  readonly root = this.page.getByTestId('drawer');
  readonly closeButton = this.page.getByTestId('dr-close');
  readonly translatedContent = this.page.getByTestId('settings-translated-content');
  readonly backupInput = this.page.getByTestId('dr-import');
  readonly formControls = [
    this.closeButton, this.page.getByTestId('dr-addrule'), this.page.getByTestId('dr-addcat'),
    this.page.getByTestId('dr-export'), this.page.getByTestId('backup-import-trigger'), this.page.getByTestId('dr-wipe'),
    this.page.getByTestId('budget-limit-input'), this.page.getByTestId('rule-match-input'),
    this.page.getByTestId('rule-category-select'), this.page.getByTestId('delete-rule-button'),
    this.page.getByTestId('category-name-input'), this.page.getByTestId('category-type-select'),
    this.page.getByTestId('delete-category-button'), this.page.getByTestId('manual-date'),
    this.page.getByTestId('manual-desc'), this.page.getByTestId('manual-dir'), this.page.getByTestId('manual-amount'),
    this.page.getByTestId('manual-cat'), this.page.getByTestId('manual-submit'),
  ];

  constructor(private readonly page: Page) {}

  @step('Open the settings panel')
  async open(): Promise<void> {
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
}
