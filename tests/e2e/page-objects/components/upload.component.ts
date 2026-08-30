import type { FilePayload, Page } from '@playwright/test';
import { resolve } from 'node:path';
import { step } from '../step';

export class UploadComponent {
  readonly bankReportInput = this.page.getByTestId('file');
  readonly creditCardInput = this.page.getByTestId('card-file');
  readonly cardTrigger = this.page.getByTestId('card-upload-trigger');
  readonly cardSourceDialog = this.page.getByTestId('card-source-dialog');

  constructor(private readonly page: Page) {}

  @step('Upload the sample bank report')
  async uploadSampleBankReport(): Promise<void> {
    await this.bankReportInput.setInputFiles(resolve('home_economy.xls'));
    await this.page.getByTestId('main').waitFor({ state: 'visible' });
  }

  @step('Upload a bank report')
  async uploadBankReport(file: FilePayload): Promise<void> {
    await this.bankReportInput.setInputFiles(file);
    await this.page.getByTestId('main').waitFor({ state: 'visible' });
  }

  /* The whole path a customer takes: the control asks which card the report is from, and
     only the answer opens the file dialog. Driving the chooser rather than setting the
     input directly keeps the test honest about the step in between. */
  @step('Upload a credit-card report')
  async uploadCreditCardReport(file: FilePayload, issuer: 'bank' | 'external' = 'bank'): Promise<void> {
    await this.chooseCardSource(file, issuer);
    await this.page.getByTestId('main').waitFor({ state: 'visible' });
  }

  @step('Choose a card source and hand over the report')
  async chooseCardSource(file: FilePayload, issuer: 'bank' | 'external' = 'bank'): Promise<void> {
    await this.cardTrigger.click();
    await this.cardSourceDialog.waitFor({ state: 'visible' });
    const chooser = this.page.waitForEvent('filechooser');
    await this.page.getByTestId(`card-source-${issuer}`).click();
    await (await chooser).setFiles(file);
  }
}
