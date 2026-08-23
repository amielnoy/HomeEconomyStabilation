import { expect, test } from './fixtures';

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('explains that a current balance is required instead of showing invented values', async ({ homePage }) => {
  await homePage.dashboard.loadSpendingGuideScenario('no-balance');

  await expect(homePage.dashboard.spendingGuideAmount).toHaveText('—');
  await expect(homePage.dashboard.spendingGuideSummary).toContainText('יתרה עדכנית');
  expect(await homePage.dashboard.spendingGuideText()).not.toMatch(/NaN|Infinity/);
});

test('does not invent daily or weekly guides when regular income is unknown', async ({ homePage }) => {
  await homePage.dashboard.loadSpendingGuideScenario('no-income');

  await expect(homePage.dashboard.spendingGuideAmount).toContainText('5,000');
  await expect(homePage.dashboard.spendingGuideWeekly).toHaveText('—');
  await expect(homePage.dashboard.spendingGuideDaily).toHaveText('—');
  await homePage.dashboard.spendingGuideDetails.locator('summary').click();
  await expect(homePage.dashboard.spendingGuideDate).toHaveText('לא זוהתה');
  expect(await homePage.dashboard.spendingGuideText()).not.toMatch(/NaN|Infinity/);
});

test('shows zero safe spending and a recovery message for a projected shortfall', async ({ homePage }) => {
  await homePage.dashboard.loadSpendingGuideScenario('shortfall');

  await expect(homePage.dashboard.spendingGuideAmount).toContainText('0');
  await expect(homePage.dashboard.spendingGuideAmount).toHaveClass(/negative/);
  await expect(homePage.dashboard.spendingGuideSummary).toContainText('גבוהים מהיתרה');
  await expect(homePage.dashboard.spendingGuideSummary).toContainText('1,000');
  await expect(homePage.dashboard.spendingGuideWeekly).toContainText('0');
  await expect(homePage.dashboard.spendingGuideDaily).toContainText('0');
  expect(await homePage.dashboard.spendingGuideText()).not.toMatch(/NaN|Infinity|−₪/);
});
