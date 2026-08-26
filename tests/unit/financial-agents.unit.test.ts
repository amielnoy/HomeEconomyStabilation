import { describe, expect, it } from 'vitest';
import {
  anomalyAgent, budgetAgent, duplicateAgent, learningAgent, missingChargeAgent,
  FinancialAgentsOrchestrator, paydayAgent, savingsOpportunityAgent, subscriptionAgent,
  type AgentTransaction, type FinancialAgentContext, type FinancialAgentStrategy,
} from '../../src/financial-agents';

const tx = (date: string, desc: string, amount: number, options: Partial<AgentTransaction> = {}): AgentTransaction => ({
  id: `${date}-${desc}-${amount}`, date, desc, out: amount, in: 0, bal: null, cat: 'home', ...options,
});

describe('independent financial agents', () => {
  it('proposes a learned rule only after two matching manual classifications', () => {
    const items = [tx('2026-01-02', 'Coffee Shop 111', 20), tx('2026-02-02', 'Coffee Shop 222', 22)];
    const overrides = Object.fromEntries(items.map((item) => [item.id!, 'food']));

    expect(learningAgent(items.slice(0, 1), overrides, [])).toBeNull();
    expect(learningAgent(items, overrides, [])).toMatchObject({ match: 'coffee shop', categoryId: 'food' });
  });

  it('compares a recurring charge with its own history', () => {
    const result = anomalyAgent([
      tx('2026-01-10', 'Electric Company', 100), tx('2026-02-10', 'Electric Company', 105),
      tx('2026-03-10', 'Electric Company', 150), tx('2026-03-10', 'Other Merchant', 500),
    ]);

    expect(result[0]).toMatchObject({ merchant: 'electric company', latest: 150 });
    expect(result[0].percent).toBeGreaterThanOrEqual(40);
  });

  it('finds an overdue recurring income that is silent in the latest month', () => {
    const result = missingChargeAgent([
      tx('2026-01-01', 'Salary Employer', 0, { out: 0, in: 9000 }),
      tx('2026-02-01', 'Salary Employer', 0, { out: 0, in: 9000 }),
      tx('2026-03-20', 'Current activity', 10),
    ]);

    expect(result).toContainEqual(expect.objectContaining({ merchant: 'salary employer', direction: 'in', amount: 9000 }));
  });

  it('finds same-merchant same-amount charges a few days apart', () => {
    expect(duplicateAgent([
      tx('2026-03-10', 'Local Store 123', 200), tx('2026-03-12', 'Local Store 456', 200),
    ])).toEqual([expect.objectContaining({ merchant: 'local store', amount: 200 })]);
  });

  it('calculates annual subscription cost and quiet price increases', () => {
    const [finding] = subscriptionAgent([
      tx('2026-01-05', 'Streaming Service', 40, { cat: 'other' }),
      tx('2026-02-05', 'Streaming Service', 40, { cat: 'other' }),
      tx('2026-03-05', 'Streaming Service', 50, { cat: 'other' }),
    ]);

    expect(finding).toBeDefined();

    expect(finding.monthly).toBe(40);
    expect(finding.annual).toBe(480);
    expect(finding.increasePercent).toBe(25);
  });

  it('does not offer obligations or the household\u2019s own cash as cancellable subscriptions', () => {
    const steadyMonths = ['2026-01', '2026-02', '2026-03', '2026-04'];
    const series = (desc: string, amount: number, cat: string) =>
      steadyMonths.map((month) => tx(`${month}-11`, desc, amount, { cat }));

    const findings = subscriptionAgent([
      ...series('\u05d7\u05e9\u05de\u05dc - \u05d7\u05d1\u05e8\u05ea \u05d4\u05d7\u05e9\u05de\u05dc', 486, 'other'),
      ...series('\u05de\u05e9\u05d9\u05db\u05d4 \u05de\u05d1\u05e0\u05e7\u05d8', 400, 'other'),
      ...series('Municipal Rates', 512, 'other'),
      ...series('Council Water', 240, 'home'),
      ...series('Streaming Service', 54.9, 'other'),
    ]);

    expect(findings.map((finding) => finding.merchant)).toEqual(['streaming service']);
  });

  it('rejects a recurring charge whose price never settles', () => {
    // A metered bill repeats but is not a subscription: there is nothing to cancel.
    expect(subscriptionAgent([
      tx('2026-01-09', 'Corner Grocer', 310, { cat: 'other' }),
      tx('2026-02-09', 'Corner Grocer', 452, { cat: 'other' }),
      tx('2026-03-09', 'Corner Grocer', 388, { cat: 'other' }),
      tx('2026-04-09', 'Corner Grocer', 501, { cat: 'other' }),
    ])).toEqual([]);
  });

  it('suggests the 75th-percentile budget rounded to a practical amount', () => {
    const result = budgetAgent([
      tx('2026-01-03', 'Food A', 610, { cat: 'food' }),
      tx('2026-02-03', 'Food B', 720, { cat: 'food' }),
      tx('2026-03-03', 'Food C', 680, { cat: 'food' }),
    ], [{ id: 'food', kind: 'expense' }]);

    expect(result).toEqual([{ categoryId: 'food', suggested: 750, months: 3 }]);
  });

  it('turns a quiet subscription price increase into a measured annual saving opportunity', () => {
    const result = savingsOpportunityAgent([
      tx('2026-01-05', 'Streaming Service', 40, { cat: 'other' }),
      tx('2026-02-05', 'Streaming Service', 40, { cat: 'other' }),
      tx('2026-03-05', 'Streaming Service', 50, { cat: 'other' }),
    ]);

    expect(result).toEqual([expect.objectContaining({
      type: 'price-increase', merchant: 'streaming service', estimatedSaving: 120,
      cadence: 'annual', increasePercent: 25,
    })]);
    expect(result[0].evidenceTransactionIds).toHaveLength(3);
  });

  it('finds recurring fees, reviewable subscriptions and one-time duplicate savings', () => {
    const result = savingsOpportunityAgent([
      tx('2026-01-02', 'Bank Account Fee', 15), tx('2026-02-02', 'Bank Account Fee', 15),
      tx('2026-01-05', 'Music Plan', 30, { cat: 'other' }),
      tx('2026-02-05', 'Music Plan', 30, { cat: 'other' }),
      tx('2026-03-05', 'Music Plan', 30, { cat: 'other' }),
      tx('2026-03-10', 'Local Store 123', 200), tx('2026-03-12', 'Local Store 456', 200),
    ]);

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'fee-review', estimatedSaving: 180, cadence: 'annual' }),
      expect.objectContaining({ type: 'subscription-review', estimatedSaving: 360, cadence: 'annual' }),
      expect.objectContaining({ type: 'duplicate-review', estimatedSaving: 200, cadence: 'one-time' }),
    ]));
  });

  it('does not invent opportunities from one ordinary charge', () => {
    expect(savingsOpportunityAgent([tx('2026-03-05', 'Local Shop', 50)])).toEqual([]);
  });

  it('allows agent strategies to be replaced through dependency injection', () => {
    const constant = <T>(value: T): FinancialAgentStrategy<T> => ({ analyze: () => value });
    const injectedSavings = [{
      id: 'test-opportunity', type: 'fee-review' as const, merchant: 'test fee',
      estimatedSaving: 120, cadence: 'annual' as const, confidence: 1, evidenceTransactionIds: [],
    }];
    const orchestrator = new FinancialAgentsOrchestrator({
      learning: constant(null), anomalies: constant([]), missing: constant([]), duplicates: constant([]),
      subscriptions: constant([]), budgetSuggestions: constant([]), savingsOpportunities: constant(injectedSavings),
      payday: constant(null),
    });
    const context: FinancialAgentContext = { transactions: [], overrides: {}, rules: [], categories: [] };

    expect(orchestrator.run(context).savingsOpportunities).toBe(injectedSavings);
  });

  it('subtracts recurring commitments due before the next salary', () => {
    const result = paydayAgent([
      tx('2026-01-01', 'Salary Employer', 0, { out: 0, in: 9000 }),
      tx('2026-02-01', 'Salary Employer', 0, { out: 0, in: 9000 }),
      tx('2026-01-25', 'Monthly Rent', 3000), tx('2026-02-25', 'Monthly Rent', 3000),
      tx('2026-03-20', 'Current activity', 10, { bal: 5000 }),
    ]);

    // balance - committed is the ceiling, never the guidance: the cushion and the
    // household's own spending rate both bind before the whole balance is offered.
    expect(result).toMatchObject({
      balance: 5000, asOf: '2026-03-20', committed: 3000, available: 2000,
      nextIncomeDate: '2026-04-01', daysRemaining: 12,
    });
    expect(result!.freeToSpend).toBeLessThanOrEqual(result!.available);
    expect(result!.freeToSpend).toBeGreaterThanOrEqual(0);
    expect(result!.dailyAllowance).toBeCloseTo(result!.freeToSpend / 12, 5);
    expect(result!.weeklyAllowance).toBeCloseTo(result!.dailyAllowance! * 7, 5);
  });

  it('rates spending over the days on record rather than a nominal ninety', () => {
    // Forty-six days of history, ₪500 of it discretionary. Dividing by a fixed
    // ninety-day window would report the household spending a third of its real
    // rate, and hand back a "safe to spend" figure to match.
    const result = paydayAgent([
      tx('2026-03-01', 'Salary Employer', 0, { out: 0, in: 9000 }),
      tx('2026-04-01', 'Salary Employer', 0, { out: 0, in: 9000 }),
      tx('2026-04-10', 'Corner Grocery', 300),
      tx('2026-04-15', 'Bookshop', 200, { bal: 5000 }),
    ]);

    const daysOnRecord = 46, daysRemaining = 16;
    expect(result).toMatchObject({ asOf: '2026-04-15', available: 5000, daysRemaining, limitedBy: 'spending-rate' });
    expect(result!.typicalSpend).toBeCloseTo((500 / daysOnRecord) * daysRemaining, 5);
    expect(result!.freeToSpend).toBeCloseTo((500 / daysOnRecord) * daysRemaining, 5);
    // The old fixed denominator would have landed here instead.
    expect(result!.typicalSpend).not.toBeCloseTo((500 / 90) * daysRemaining, 5);
  });

  it('returns an explicit unavailable result when no balance exists', () => {
    expect(paydayAgent([
      tx('2026-01-01', 'Salary Employer', 0, { out: 0, in: 9000 }),
      tx('2026-02-01', 'Salary Employer', 0, { out: 0, in: 9000 }),
    ])).toBeNull();
  });

  it('does not invent time allowances without recurring income', () => {
    expect(paydayAgent([
      tx('2026-03-20', 'Current activity', 10, { bal: 5000 }),
    ])).toEqual({
      balance: 5000, asOf: '2026-03-20', nextIncomeDate: null, committed: 0,
      available: 5000, retained: 10, typicalSpend: 0, freeToSpend: 5000,
      limitedBy: 'balance', daysRemaining: null, dailyAllowance: null, weeklyAllowance: null,
    });
  });

  it('keeps a negative runway finite when commitments exceed the balance', () => {
    const result = paydayAgent([
      tx('2026-01-01', 'Salary Employer', 0, { out: 0, in: 9000 }),
      tx('2026-02-01', 'Salary Employer', 0, { out: 0, in: 9000 }),
      tx('2026-01-25', 'Monthly Rent', 6000), tx('2026-02-25', 'Monthly Rent', 6000),
      tx('2026-03-20', 'Current activity', 10, { bal: 5000 }),
    ]);

    // A shortfall now surfaces as a negative `available`; `freeToSpend` is floored at
    // zero, because "spend a negative amount" was never guidance anyone could act on.
    expect(result).toMatchObject({ committed: 6000, available: -1000, freeToSpend: 0, daysRemaining: 12 });
    expect(result?.dailyAllowance).toBe(0);
    expect(Number.isFinite(result?.weeklyAllowance)).toBe(true);
  });

  it('clamps a month-end payday to the last real day of a shorter month', () => {
    const result = paydayAgent([
      tx('2025-12-31', 'Salary Employer', 0, { out: 0, in: 9000 }),
      tx('2026-01-31', 'Salary Employer', 0, { out: 0, in: 9000 }),
      tx('2026-02-20', 'Current activity', 10, { bal: 5000 }),
    ]);

    expect(result).toMatchObject({ nextIncomeDate: '2026-02-28', daysRemaining: 8 });
  });
});
