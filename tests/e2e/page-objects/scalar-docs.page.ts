import type { Page } from '@playwright/test';
import { BasePage } from './base.page';
import { step } from './step';

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
  readonly profileEndpoints = this.page.getByRole('list', { name: 'Profile endpoints' });
  readonly loadProfileOperation = this.profileEndpoints.getByRole('listitem').filter({ hasText: /get\s*\/api\/profile/ });
  readonly saveProfileOperation = this.profileEndpoints.getByRole('listitem').filter({ hasText: /put\s*\/api\/profile/ });
  readonly consentEndpoints = this.page.getByRole('list', { name: 'Consent endpoints' });
  readonly loadConsentOperation = this.consentEndpoints.getByRole('listitem').filter({ hasText: /get\s*\/api\/consents\/cloud-sync/ });
  readonly acceptConsentOperation = this.consentEndpoints.getByRole('listitem').filter({ hasText: /put\s*\/api\/consents\/cloud-sync/ });
  readonly withdrawConsentOperation = this.consentEndpoints.getByRole('listitem').filter({ hasText: /delete\s*\/api\/consents\/cloud-sync/ });

  constructor(page: Page) {
    const scalarOrigin = process.env.PLAYWRIGHT_SCALAR_BASE_URL?.replace(/\/$/, '');
    super(page, scalarOrigin ? `${scalarOrigin}/scalar-docs.html` : '/scalar-docs.html');
  }

  /**
   * Scalar mounts each tag section only as the reader reaches it, so on a phone-sized
   * viewport the Profile and Consent groups are absent from the DOM entirely — not
   * merely collapsed. Walking the document to the end mounts them all, and works the
   * same on desktop and mobile, where the sidebar group buttons are hidden behind the
   * menu and duplicated between two sidebars.
   */
  @step('Scroll through the reference so every operation group is mounted')
  async revealAllOperations(): Promise<void> {
    await this.page.evaluate(async () => {
      const settle = () => new Promise((resolve) => { setTimeout(resolve, 180); });
      let previousHeight = -1;
      for (let attempt = 0; attempt < 25; attempt += 1) {
        window.scrollTo(0, document.body.scrollHeight);
        await settle();
        if (document.body.scrollHeight === previousHeight) break;
        previousHeight = document.body.scrollHeight;
      }
      window.scrollTo(0, 0);
    });
  }
}
