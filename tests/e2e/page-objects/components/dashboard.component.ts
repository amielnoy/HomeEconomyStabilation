import type { Page } from '@playwright/test';
import { step } from '../step';

export class DashboardComponent {
  readonly root = this.page.getByTestId('main');
  readonly monthChips = this.page.getByTestId('month-chip');
  readonly transactionRows = this.page.getByTestId('transaction-row');
  readonly transactionBalances = this.page.getByTestId('transaction-balance');
  readonly accountSummary = this.page.getByTestId('acct');
  readonly balance = this.page.getByTestId('t-bal');
  readonly spendingGuide = this.page.getByTestId('spending-guide');
  readonly spendingGuideAmount = this.page.getByTestId('spending-guide-amount');
  readonly spendingGuideSummary = this.page.getByTestId('spending-guide-summary');
  readonly spendingGuideWeekly = this.page.getByTestId('spending-guide-weekly');
  readonly spendingGuideDaily = this.page.getByTestId('spending-guide-daily');
  readonly spendingGuideDetails = this.page.getByTestId('spending-guide-details');
  readonly spendingGuideBalance = this.page.getByTestId('spending-guide-balance');
  readonly spendingGuideCommitted = this.page.getByTestId('spending-guide-committed');
  readonly spendingGuideDate = this.page.getByTestId('spending-guide-date');
  readonly recommendationButton = this.page.getByTestId('btn-recommendations');
  readonly recommendations = this.page.getByTestId('recommendations');
  readonly recommendationNote = this.page.getByTestId('rec-screen-note');
  readonly recommendationCards = this.page.getByTestId('recommendation-card');
  readonly recommendationActions = this.page.getByTestId('recommendation-action');
  readonly forecastChart = this.page.getByTestId('fc');
  readonly forecastTooltip = this.page.getByTestId('fc-tip');
  readonly agents = this.page.getByTestId('agents');
  readonly agentsHeading = this.page.getByTestId('agents-h');
  readonly learningAgent = this.page.getByTestId('agent-learning');
  readonly anomalyAgent = this.page.getByTestId('agent-anomalies');
  readonly missingAgent = this.page.getByTestId('agent-missing');
  readonly duplicateAgent = this.page.getByTestId('agent-duplicates');
  readonly subscriptionAgent = this.page.getByTestId('agent-subscriptions');
  readonly budgetAgent = this.page.getByTestId('agent-budget');
  readonly savingsAgent = this.page.getByTestId('agent-savings');
  readonly savingsOpportunitySummary = this.page.getByTestId('savings-opportunity-summary');
  readonly savingsOpportunities = this.page.getByTestId('savings-opportunity');
  readonly savingsOpportunityDetails = this.page.getByTestId('savings-opportunity-details');
  readonly paydayAgent = this.page.getByTestId('agent-payday');
  readonly approveLearningRule = this.page.getByTestId('approve-learning-rule');
  readonly applyBudgetSuggestion = this.page.getByTestId('apply-budget-suggestion');
  readonly dynamicRegionIds = ['fc-note', 'bd-note', 'cat-note', 'rc-note', 'tx-count', 'foot-note', 'attention'];
  readonly dynamicRegions = this.dynamicRegionIds.map((testId) => this.page.getByTestId(testId));

  constructor(private readonly page: Page) {}

  @step('Load a complete financial-agent example')
  async loadAgentScenario(): Promise<void> {
    const transaction = (id: string, date: string, desc: string, out: number, input: Partial<{
      in: number; bal: number | null; cat: string;
    }> = {}) => ({
      id, date, vdate: date, ref: id, desc, out, in: 0, bal: null, pending: false,
      source: 'bank', src: 'agent-scenario.csv', cat: 'home', ...input,
    });
    const tx = [
      transaction('salary-jan', '2026-01-01', 'Salary Employer', 0, { in: 9000, cat: 'income' }),
      transaction('salary-feb', '2026-02-01', 'Salary Employer', 0, { in: 9000, cat: 'income' }),
      transaction('electric-jan', '2026-01-10', 'Electric Company', 100),
      transaction('electric-feb', '2026-02-10', 'Electric Company', 105),
      transaction('electric-mar', '2026-03-10', 'Electric Company', 150),
      transaction('stream-jan', '2026-01-05', 'Streaming Service', 40),
      transaction('stream-feb', '2026-02-05', 'Streaming Service', 40),
      transaction('stream-mar', '2026-03-05', 'Streaming Service', 50),
      transaction('rent-jan', '2026-01-25', 'Monthly Rent', 3000),
      transaction('rent-feb', '2026-02-25', 'Monthly Rent', 3000),
      transaction('dup-one', '2026-03-10', 'Local Store 123', 200, { cat: 'food' }),
      transaction('dup-two', '2026-03-12', 'Local Store 456', 200, { cat: 'food' }),
      transaction('coffee-one', '2026-03-13', 'Coffee Shop 111', 20, { cat: 'food' }),
      transaction('coffee-two', '2026-03-14', 'Coffee Shop 222', 22, { cat: 'food' }),
      transaction('current', '2026-03-20', 'Current activity', 10, { bal: 5000 }),
    ];
    await this.page.evaluate((state) => localStorage.setItem('mazan-habait/v1', JSON.stringify(state)), {
      tx,
      overrides: { 'coffee-one': 'food', 'coffee-two': 'food' },
      rules: [],
      cats: [
        { id: 'home', name: 'Home', kind: 'expense' }, { id: 'food', name: 'Food', kind: 'expense' },
        { id: 'other', name: 'Other', kind: 'expense' }, { id: 'income', name: 'Income', kind: 'income' },
      ],
      budgets: {}, accounts: ['agent-scenario'],
    });
    await this.page.reload();
  }

  @step('Load a safe-to-spend sanity example')
  async loadSpendingGuideScenario(kind: 'no-balance' | 'no-income' | 'shortfall'): Promise<void> {
    await this.page.evaluate((scenario) => {
      const transaction = (id: string, date: string, desc: string, out: number, input: Partial<{
        in: number; bal: number | null; cat: string;
      }> = {}) => ({
        id, date, vdate: date, ref: id, desc, out, in: 0, bal: null, pending: false,
        source: 'bank', src: 'spending-guide-sanity.csv', cat: 'home', ...input,
      });
      const salary = [
        transaction('salary-jan', '2026-01-01', 'Salary Employer', 0, { in: 9000, cat: 'income' }),
        transaction('salary-feb', '2026-02-01', 'Salary Employer', 0, { in: 9000, cat: 'income' }),
      ];
      const tx = scenario === 'no-balance'
        ? [...salary, transaction('current', '2026-03-20', 'Current activity', 10)]
        : scenario === 'no-income'
          ? [transaction('current', '2026-03-20', 'Current activity', 10, { bal: 5000 })]
          : [
            ...salary,
            transaction('rent-jan', '2026-01-25', 'Monthly Rent', 6000),
            transaction('rent-feb', '2026-02-25', 'Monthly Rent', 6000),
            transaction('current', '2026-03-20', 'Current activity', 10, { bal: 5000 }),
          ];
      localStorage.setItem('mazan-habait/v1', JSON.stringify({
        tx, overrides: {}, rules: [], budgets: {}, accounts: ['sanity'],
        cats: [
          { id: 'home', name: 'Home', kind: 'expense' },
          { id: 'income', name: 'Income', kind: 'income' },
        ],
      }));
    }, kind);
    await this.page.reload();
  }

  @step('Read every safe-to-spend value')
  async spendingGuideText(): Promise<string> {
    return this.spendingGuide.innerText();
  }

  @step('Read the saved learned categorization rule')
  async readLearnedRule(match: string): Promise<{ match: string; cat: string } | undefined> {
    return this.page.evaluate((expectedMatch) => {
      const state = JSON.parse(localStorage.getItem('mazan-habait/v1') || '{}');
      return state.rules?.find((rule: { match: string }) => rule.match === expectedMatch);
    }, match);
  }

  @step('Read the saved suggested budgets')
  async readSavedBudgets(): Promise<Record<string, number>> {
    return this.page.evaluate(() => JSON.parse(localStorage.getItem('mazan-habait/v1') || '{}').budgets || {});
  }

  @step('Read the privacy-safe browser snapshot')
  async readPersistedState(): Promise<Record<string, unknown>> {
    return this.page.evaluate(() => JSON.parse(localStorage.getItem('mazan-habait/v1') || '{}'));
  }

  @step('Open the recommendations')
  async openRecommendations(): Promise<void> {
    if (!await this.recommendationButton.isVisible()) await this.page.getByTestId('mobile-menu-toggle').click();
    await this.recommendationButton.click();
  }

  @step('Read the generated dashboard messages')
  async dynamicRegionTexts(): Promise<Array<{ selector: string; text: string }>> {
    return Promise.all(this.dynamicRegionIds.map(async (testId) => ({
      selector: testId,
      text: await this.page.getByTestId(testId).innerText(),
    })));
  }

  @step('Find the expected text in the forecast tooltip')
  async findForecastTooltipText(expected: string): Promise<boolean> {
    return this.page.evaluate((text) => {
      const svg = document.querySelector<SVGSVGElement>('[data-testid="fc"]')!;
      const hit = svg.querySelector<SVGRectElement>('rect[fill="transparent"]')!;
      const bounds = svg.getBoundingClientRect();
      for (let step = 0; step <= 120; step += 1) {
        hit.dispatchEvent(new PointerEvent('pointermove', {
          clientX: bounds.left + (bounds.width * step) / 120,
          clientY: bounds.top + 50,
          bubbles: true,
        }));
        if (document.querySelector('[data-testid="fc-tip"]')?.textContent?.includes(text)) return true;
      }
      return false;
    }, expected);
  }
}
