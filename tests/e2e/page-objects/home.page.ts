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
  readonly emptyState = this.page.getByTestId('empty');
  readonly toast = this.page.getByTestId('toast');
  readonly header = this.page.getByTestId('app-header');
  readonly mobileMenuToggle = this.page.getByTestId('mobile-menu-toggle');
  readonly secondaryActions = this.page.getByTestId('secondary-actions');
  readonly bankUploadTrigger = this.page.getByTestId('bank-upload-trigger');
  readonly cardUploadTrigger = this.page.getByTestId('card-upload-trigger');
  readonly recommendationsTrigger = this.page.getByTestId('btn-recommendations');
  readonly savingsTrigger = this.page.getByTestId('btn-savings');
  readonly mobilePrimaryControls = [
    this.bankUploadTrigger, this.cardUploadTrigger, this.mobileMenuToggle,
    this.page.getByTestId('marketing-upload'), this.page.getByTestId('marketing-how'),
    this.page.getByTestId('marketing-upload-final'),
  ];
  readonly mobileSecondaryControls = [
    this.recommendationsTrigger, this.savingsTrigger, this.page.getByTestId('locale-select'),
    this.page.getByTestId('btn-set'), this.page.getByTestId('btn-backup'),
  ];
  readonly mobileDashboardControls = [
    this.page.getByTestId('month-chip'), this.page.getByTestId('btn-dashboard'),
    this.page.getByTestId('fc-horizon'), this.page.getByTestId('btn-bud'), this.page.getByTestId('btn-cattbl'),
    this.page.getByTestId('q'), this.page.getByTestId('f-cat'), this.page.getByTestId('f-dir'),
    this.page.getByTestId('f-scope'), this.page.getByTestId('transaction-category-select'),
    this.page.getByTestId('approve-learning-rule'), this.page.getByTestId('apply-budget-suggestion'),
  ];

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
