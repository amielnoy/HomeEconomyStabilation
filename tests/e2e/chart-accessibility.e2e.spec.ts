import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { richBankReport } from './reports';

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
  await homePage.upload.uploadBankReport(richBankReport());
  await expect(homePage.dashboard.root).toBeVisible();
});

/* role="img" with a single aria-label announces that a chart exists and nothing about
   what it shows. Both charts publish their figures as a table as well. */
test('publishes both charts as data tables a screen reader can read', async ({ homePage }) => {
  const waterline = homePage.page.getByTestId('wl-table');
  const forecast = homePage.page.getByTestId('fc-table');

  await homePage.page.getByTestId('wl-data').locator('summary').click();
  await expect(waterline.locator('thead th').first()).toBeVisible();
  // One row per month charted, each naming its month in a row header.
  const monthRows = waterline.locator('tbody tr');
  expect(await monthRows.count()).toBeGreaterThan(1);
  await expect(monthRows.first().locator('th[scope="row"]')).toHaveCount(1);

  await homePage.page.getByTestId('fc-data').locator('summary').click();
  await expect(forecast.locator('tbody tr').first()).toBeVisible();
  expect(await forecast.locator('tbody tr').count()).toBeGreaterThan(1);
  // The projection's uncertainty is part of the reading, not just of the picture.
  await expect(forecast.locator('tbody tr').first().locator('td').last()).toContainText('–');
});

test('the chart tables introduce no accessibility violations', async ({ homePage }) => {
  await homePage.page.getByTestId('wl-data').locator('summary').click();
  await homePage.page.getByTestId('fc-data').locator('summary').click();

  const results = await new AxeBuilder({ page: homePage.page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
});
