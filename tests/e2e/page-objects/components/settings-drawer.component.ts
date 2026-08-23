import type { FilePayload, Page } from '@playwright/test';
import { step } from '../step';

export class SettingsDrawerComponent {
  readonly openButton = this.page.locator('#btn-set');
  readonly root = this.page.locator('#drawer');
  readonly closeButton = this.page.locator('#dr-close');
  readonly translatedContent = this.root.locator('[data-i18n]');
  readonly backupInput = this.page.locator('#dr-import');
  readonly formControls = this.root.locator('button, label.btn, input:not([type="hidden"]), select');

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
