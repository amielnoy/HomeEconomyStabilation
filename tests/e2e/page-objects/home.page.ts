import type { Page } from '@playwright/test';
import { BasePage } from './base.page';
import { DashboardComponent } from './components/dashboard.component';
import { LanguagePickerComponent } from './components/language-picker.component';
import { MarketingComponent } from './components/marketing.component';
import { SavingsDirectoryComponent } from './components/savings-directory.component';
import { SettingsDrawerComponent } from './components/settings-drawer.component';
import { UploadComponent } from './components/upload.component';

export interface HomePageComponents {
  language: LanguagePickerComponent;
  upload: UploadComponent;
  marketing: MarketingComponent;
  dashboard: DashboardComponent;
  settings: SettingsDrawerComponent;
  savingsDirectory: SavingsDirectoryComponent;
}

export class HomePage extends BasePage {
  readonly language: LanguagePickerComponent;
  readonly upload: UploadComponent;
  readonly marketing: MarketingComponent;
  readonly dashboard: DashboardComponent;
  readonly settings: SettingsDrawerComponent;
  readonly savingsDirectory: SavingsDirectoryComponent;
  readonly emptyState = this.page.locator('#empty');
  readonly toast = this.page.locator('#toast');
  readonly mobilePrimaryControls = this.page.locator([
    '.topbar .btn',
    '#locale-select',
    '#marketing-upload',
    '#marketing-how',
    '#marketing-upload-final',
  ].join(','));
  readonly mobileDashboardControls = this.page.locator([
    '#months .mchip',
    '#main button',
    '#main select',
    '#main input:not([type="hidden"])',
  ].join(','));

  constructor(page: Page, components: HomePageComponents) {
    super(page, '/mazan-habait.html');
    this.language = components.language;
    this.upload = components.upload;
    this.marketing = components.marketing;
    this.dashboard = components.dashboard;
    this.settings = components.settings;
    this.savingsDirectory = components.savingsDirectory;
  }
}
