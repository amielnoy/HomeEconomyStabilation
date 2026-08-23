import { describe, expect, it } from 'vitest';
import { runFinancialAgents } from '../../src/financial-agents';

describe('financial agents API', () => {
  it('returns one stable result slot for every independent agent', () => {
    const result = runFinancialAgents({ transactions: [], overrides: {}, rules: [], categories: [] });

    expect(Object.keys(result)).toEqual([
      'learning', 'anomalies', 'missing', 'duplicates', 'subscriptions', 'budgetSuggestions', 'payday',
    ]);
  });
});
