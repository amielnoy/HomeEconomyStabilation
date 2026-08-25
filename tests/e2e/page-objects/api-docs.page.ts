import type { Page } from '@playwright/test';
import { BasePage } from './base.page';

export class ApiDocsPage extends BasePage {
  readonly root = this.page.getByTestId('swagger-api-docs');
  readonly scalarLink = this.page.getByTestId('scalar-docs-link');
  readonly authorizeButton = this.page.getByRole('button', { name: /authorize/i });
  readonly healthOperation = this.page.getByText('Check API availability', { exact: true });
  readonly loadOperation = this.page.getByText("Load the current user's snapshot", { exact: true });
  readonly saveOperation = this.page.getByText("Create or replace the current user's snapshot", { exact: true });
  readonly deleteOperation = this.page.getByText("Delete the current user's cloud snapshot", { exact: true });
  readonly loadProfileOperation = this.page.getByText("Load the current user's preferred locale", { exact: true });
  readonly saveProfileOperation = this.page.getByText("Create or update the current user's preferred locale", { exact: true });
  readonly loadConsentOperation = this.page.getByText('Load the current cloud-sync consent statement', { exact: true });
  readonly acceptConsentOperation = this.page.getByText('Accept the current cloud-sync consent statement', { exact: true });
  readonly withdrawConsentOperation = this.page.getByText('Withdraw the current cloud-sync consent statement', { exact: true });

  constructor(page: Page) {
    super(page, '/api-docs.html');
  }
}
