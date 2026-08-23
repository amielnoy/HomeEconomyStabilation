import { test, expect } from './fixtures';

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('uploads and processes the supplied bank workbook', async ({ homePage }) => {
  await homePage.upload.uploadSampleBankReport();

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.monthChips).toContainText('אוגוסט 2026');
  await expect(homePage.dashboard.transactionRows).toHaveCount(5);
  await expect(homePage.dashboard.accountSummary).toContainText('04-279-661711');
});

test('exposes the credit-card upload control in the live UI', async ({ homePage }) => {
  const input = homePage.upload.creditCardInput;

  await expect(input).toHaveAttribute('accept', /\.xls/);
  await expect(input).toHaveAttribute('multiple', '');
});

test('shows prioritized customer recommendations', async ({ homePage }) => {
  await homePage.upload.uploadSampleBankReport();
  await expect(homePage.dashboard.root).toBeVisible();

  await homePage.dashboard.openRecommendations();
  await expect(homePage.dashboard.recommendations).toBeVisible();
  await expect(homePage.dashboard.recommendationNote).toContainText('חשבון 04-279-661711');
  await expect(homePage.dashboard.recommendationCards).not.toHaveCount(0);
  await expect(homePage.dashboard.recommendationActions.first()).toBeVisible();
});

test('guides the customer to import data when recommendations are not ready yet', async ({ homePage }) => {
  await homePage.dashboard.openRecommendations();

  await expect(homePage.toast).toContainText('כדי לקבל המלצות, טענו תחילה דוח בנק');
  await expect(homePage.marketing.primaryUpload).toBeFocused();
  await expect(homePage.emptyState).toBeVisible();
});
