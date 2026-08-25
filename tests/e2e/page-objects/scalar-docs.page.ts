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
   *
   * The stopping condition is the groups themselves rather than a settled page height:
   * a section that is still mounting leaves the height unchanged for a frame, and on
   * WebKit that plateau arrived before Profile and Consent existed.
   */
  @step('Scroll through the reference so every operation group is mounted')
  async revealAllOperations(): Promise<void> {
    const groups = [this.snapshotEndpoints, this.profileEndpoints, this.consentEndpoints];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const mounted = await Promise.all(groups.map((group) => group.count()));
      if (mounted.every((count) => count > 0)) break;
      await this.page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
      await this.page.waitForTimeout(180);
    }
    await this.page.evaluate(() => { window.scrollTo(0, 0); });
  }
}
