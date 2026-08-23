import { expect, test } from './fixtures';

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
  await homePage.dashboard.loadAgentScenario();
});

test('shows seven independent agents with findings from their own histories', async ({ homePage }) => {
  await expect(homePage.dashboard.agents).toBeVisible();
  for (const agent of [
    homePage.dashboard.learningAgent, homePage.dashboard.anomalyAgent, homePage.dashboard.missingAgent,
    homePage.dashboard.duplicateAgent, homePage.dashboard.subscriptionAgent,
    homePage.dashboard.budgetAgent, homePage.dashboard.paydayAgent,
  ]) await expect(agent).toBeVisible();

  await expect(homePage.dashboard.anomalyAgent).toContainText('electric company');
  await expect(homePage.dashboard.missingAgent).toContainText('salary employer');
  await expect(homePage.dashboard.duplicateAgent).toContainText('local store');
  await expect(homePage.dashboard.subscriptionAgent).toContainText('streaming service');
  await expect(homePage.dashboard.paydayAgent).toContainText('2,000');
});

test('leads with a transparent safe-to-spend guide', async ({ homePage }) => {
  await expect(homePage.dashboard.spendingGuide).toBeVisible();
  await expect(homePage.dashboard.spendingGuideAmount).toContainText('2,000');
  await expect(homePage.dashboard.spendingGuideSummary).toContainText('12');
  await expect(homePage.dashboard.spendingGuideWeekly).toContainText('1,167');
  await expect(homePage.dashboard.spendingGuideDaily).toContainText('167');

  await homePage.dashboard.spendingGuideDetails.locator('summary').click();
  await expect(homePage.dashboard.spendingGuideBalance).toContainText('5,000');
  await expect(homePage.dashboard.spendingGuideCommitted).toContainText('3,000');
});

test('requires explicit approval before saving a learned categorization rule', async ({ homePage }) => {
  await expect(homePage.dashboard.learningAgent).toContainText('coffee shop');
  await expect(homePage.dashboard.approveLearningRule).toBeVisible();

  await homePage.dashboard.approveLearningRule.click();

  await expect(homePage.toast).toContainText('הכלל הלומד נוסף');
  await expect(homePage.dashboard.approveLearningRule).toHaveCount(0);
  const learnedRule = await homePage.dashboard.readLearnedRule('coffee shop');
  expect(learnedRule).toMatchObject({ match: 'coffee shop', cat: 'food' });
});

test('applies a suggested budget only after explicit approval', async ({ homePage }) => {
  await expect(homePage.dashboard.applyBudgetSuggestion.first()).toBeVisible();
  await homePage.dashboard.applyBudgetSuggestion.first().click();

  await expect(homePage.toast).toContainText('תקרת התקציב עודכנה');
  const budgets = await homePage.dashboard.readSavedBudgets();
  expect(Object.keys(budgets).length).toBeGreaterThan(0);
});

test('translates the agent workspace cleanly', async ({ homePage }) => {
  await homePage.language.choose('fr');
  await expect(homePage.dashboard.agentsHeading).toHaveText('Vos agents financiers');
  await expect(homePage.dashboard.paydayAgent).toContainText('Il reste');

  await homePage.language.choose('am');
  await expect(homePage.dashboard.agentsHeading).toHaveText('የእርስዎ የገንዘብ ወኪሎች');
});
