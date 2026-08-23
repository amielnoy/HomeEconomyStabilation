import type { Page } from '@playwright/test';
import { BasePage } from './base.page';

export class ScalarDocsPage extends BasePage {
  readonly root = this.page.getByTestId('scalar-api-docs');
  readonly reference = this.page.getByTestId('scalar-api-reference');
  readonly swaggerLink = this.page.getByTestId('swagger-docs-link');
  readonly healthOperation = this.page.getByRole('heading', { name: 'Check API availability', exact: true });
  readonly testHealthRequestButton = this.page.getByRole('button', { name: 'Test Request (get /api/health)' });
  readonly snapshotEndpoints = this.page.getByRole('list', { name: 'Snapshots endpoints' });
  readonly loadOperation = this.snapshotEndpoints.getByRole('listitem').filter({ hasText: /get\s*\/api\/snapshots/ });
  readonly saveOperation = this.snapshotEndpoints.getByRole('listitem').filter({ hasText: /put\s*\/api\/snapshots/ });
  readonly deleteOperation = this.snapshotEndpoints.getByRole('listitem').filter({ hasText: /delete\s*\/api\/snapshots/ });

  constructor(page: Page) {
    const scalarOrigin = process.env.PLAYWRIGHT_SCALAR_BASE_URL?.replace(/\/$/, '');
    super(page, scalarOrigin ? `${scalarOrigin}/scalar-docs.html` : '/scalar-docs.html');
  }

}
