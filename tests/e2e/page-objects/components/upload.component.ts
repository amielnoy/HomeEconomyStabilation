import type { FilePayload, Page } from '@playwright/test';
import { resolve } from 'node:path';
import { step } from '../step';

export class UploadComponent {
  readonly bankReportInput = this.page.locator('#file');
  readonly creditCardInput = this.page.locator('#card-file');

  constructor(private readonly page: Page) {}

  @step('Upload the sample bank report')
  async uploadSampleBankReport(): Promise<void> {
    await this.bankReportInput.setInputFiles(resolve('home_economy.xls'));
  }

  @step('Upload a bank report')
  async uploadBankReport(file: FilePayload): Promise<void> {
    await this.bankReportInput.setInputFiles(file);
  }
}
