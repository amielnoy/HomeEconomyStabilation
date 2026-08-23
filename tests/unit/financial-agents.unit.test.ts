import { describe, expect, it } from 'vitest';
import {
  anomalyAgent, budgetAgent, duplicateAgent, learningAgent, missingChargeAgent,
  paydayAgent, subscriptionAgent, type AgentTransaction,
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
      tx('2026-01-05', 'Streaming Service', 40), tx('2026-02-05', 'Streaming Service', 40),
      tx('2026-03-05', 'Streaming Service', 50),
    ]);

    expect(finding.monthly).toBe(40);
    expect(finding.annual).toBe(480);
    expect(finding.increasePercent).toBe(25);
  });

  it('suggests the 75th-percentile budget rounded to a practical amount', () => {
    const result = budgetAgent([
      tx('2026-01-03', 'Food A', 610, { cat: 'food' }),
      tx('2026-02-03', 'Food B', 720, { cat: 'food' }),
      tx('2026-03-03', 'Food C', 680, { cat: 'food' }),
    ], [{ id: 'food', kind: 'expense' }]);

    expect(result).toEqual([{ categoryId: 'food', suggested: 750, months: 3 }]);
  });

  it('subtracts recurring commitments due before the next salary', () => {
    const result = paydayAgent([
      tx('2026-01-01', 'Salary Employer', 0, { out: 0, in: 9000 }),
      tx('2026-02-01', 'Salary Employer', 0, { out: 0, in: 9000 }),
      tx('2026-01-25', 'Monthly Rent', 3000), tx('2026-02-25', 'Monthly Rent', 3000),
      tx('2026-03-20', 'Current activity', 10, { bal: 5000 }),
    ]);

    expect(result).toMatchObject({
      balance: 5000, committed: 3000, freeToSpend: 2000, nextIncomeDate: '2026-04-01',
      daysRemaining: 12,
    });
    expect(result?.dailyAllowance).toBeCloseTo(166.67, 1);
    expect(result?.weeklyAllowance).toBeCloseTo(1166.67, 1);
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
      balance: 5000, nextIncomeDate: null, committed: 0, freeToSpend: 5000,
      daysRemaining: null, dailyAllowance: null, weeklyAllowance: null,
    });
  });

  it('keeps a negative runway finite when commitments exceed the balance', () => {
    const result = paydayAgent([
      tx('2026-01-01', 'Salary Employer', 0, { out: 0, in: 9000 }),
      tx('2026-02-01', 'Salary Employer', 0, { out: 0, in: 9000 }),
      tx('2026-01-25', 'Monthly Rent', 6000), tx('2026-02-25', 'Monthly Rent', 6000),
      tx('2026-03-20', 'Current activity', 10, { bal: 5000 }),
    ]);

    expect(result).toMatchObject({ freeToSpend: -1000, daysRemaining: 12 });
    expect(result?.dailyAllowance).toBeCloseTo(-83.33, 1);
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
