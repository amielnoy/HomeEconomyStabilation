import type { Page } from '@playwright/test';
import { BasePage } from './base.page';

export class ArchitecturePage extends BasePage {
  readonly title = this.page.getByRole('heading', { level: 1 });
  readonly sections = this.page.locator('main > h2');
  readonly diagram = this.page.locator('.diagram svg');
  readonly applicationLink = this.page.getByRole('link', { name: /Open application/ });

  constructor(page: Page) {
    super(page, '/Architecture.html');
  }
}
