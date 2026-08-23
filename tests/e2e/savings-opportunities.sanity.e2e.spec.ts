import { expect, test } from './fixtures';

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
  await homePage.dashboard.loadAgentScenario();
  await homePage.language.choose('en');
});

test('keeps annual and one-time saving estimates separate', async ({ homePage }) => {
  await expect(homePage.dashboard.savingsOpportunitySummary).toContainText('₪120');
  await expect(homePage.dashboard.savingsAgent).toContainText('Annual potential: ₪120');
  await expect(homePage.dashboard.savingsAgent).toContainText('One-time potential: ₪200');
});

test('offers evidence without an automatic cancellation action', async ({ homePage }) => {
  await expect(homePage.dashboard.savingsAgent.getByRole('button')).toHaveCount(0);
  await homePage.dashboard.savingsOpportunityDetails.first().locator('summary').click();
  await expect(homePage.dashboard.savingsOpportunityDetails.first()).toContainText('detection confidence');
  await expect(homePage.dashboard.savingsAgent).toContainText('Verify with the provider before cancelling');
});
