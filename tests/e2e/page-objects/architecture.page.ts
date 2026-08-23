import type { Page } from '@playwright/test';
import { BasePage } from './base.page';

export class ArchitecturePage extends BasePage {
  readonly title = this.page.getByTestId('architecture-title');
  readonly sections = this.page.getByTestId('architecture-section');
  readonly diagram = this.page.getByTestId('architecture-diagram');
  readonly applicationLink = this.page.getByTestId('architecture-app-link');

  constructor(page: Page) {
    super(page, '/Architecture.html');
  }
}
