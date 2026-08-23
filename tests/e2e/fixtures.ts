import { test as base, expect } from '@playwright/test';
import { ArchitecturePage } from './page-objects/architecture.page';
import { DashboardComponent } from './page-objects/components/dashboard.component';
import { LanguagePickerComponent } from './page-objects/components/language-picker.component';
import { MarketingComponent } from './page-objects/components/marketing.component';
import { SavingsDirectoryComponent } from './page-objects/components/savings-directory.component';
import { SettingsDrawerComponent } from './page-objects/components/settings-drawer.component';
import { UploadComponent } from './page-objects/components/upload.component';
import { HomePage } from './page-objects/home.page';

interface PageFixtures {
  languagePicker: LanguagePickerComponent;
  uploadComponent: UploadComponent;
  marketingComponent: MarketingComponent;
  dashboardComponent: DashboardComponent;
  settingsDrawer: SettingsDrawerComponent;
  savingsDirectory: SavingsDirectoryComponent;
  homePage: HomePage;
  architecturePage: ArchitecturePage;
}

export const test = base.extend<PageFixtures>({
  languagePicker: async ({ page }, use) => {
    await use(new LanguagePickerComponent(page));
  },
  uploadComponent: async ({ page }, use) => {
    await use(new UploadComponent(page));
  },
  marketingComponent: async ({ page }, use) => {
    await use(new MarketingComponent(page));
  },
  dashboardComponent: async ({ page }, use) => {
    await use(new DashboardComponent(page));
  },
  settingsDrawer: async ({ page }, use) => {
    await use(new SettingsDrawerComponent(page));
  },
  savingsDirectory: async ({ page }, use) => {
    await use(new SavingsDirectoryComponent(page));
  },
  homePage: async ({
    page,
    languagePicker,
    uploadComponent,
    marketingComponent,
    dashboardComponent,
    settingsDrawer,
    savingsDirectory,
  }, use) => {
    await use(new HomePage(page, {
      language: languagePicker,
      upload: uploadComponent,
      marketing: marketingComponent,
      dashboard: dashboardComponent,
      settings: settingsDrawer,
      savingsDirectory,
    }));
  },
  architecturePage: async ({ page }, use) => {
    await use(new ArchitecturePage(page));
  },
});

export { expect };
