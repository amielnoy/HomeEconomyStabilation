import { describe, expect, it } from 'vitest';
import { RuleBasedTransactionCategorizer } from '../../src/categorization';
import type { BankTransaction, Rule } from '../../src/domain-model';

const transaction = (desc: string, incoming = 0): BankTransaction => ({
  date: '2026-08-09', vdate: '2026-08-09', ref: '', desc, out: incoming ? 0 : 100,
  in: incoming, bal: null, pending: false, source: 'bank', src: 'bank-report', id: desc,
});
const rules: Rule[] = [
  { id: 'transfer', match: 'משיכה לחשבון הבנק', cat: 'savings' },
  { id: 'alimony', match: 'מזונות', cat: 'home' },
];

describe('rule-based transaction categorization', () => {
  const categorizer = new RuleBasedTransactionCategorizer();

  it.each([
    ['המבצע: עמיאל פלד עבור: משיכה לחשבון הבנק', 'savings'],
    ['לטובת: אסתר אושרית פלד עבור: מזונות', 'home'],
  ])('classifies %s as %s from descriptive evidence', (description, expected) => {
    expect(categorizer.categorize(transaction(description), {}, rules)).toBe(expected);
  });

  it('keeps an unexplained debit as other and recognizes an incoming transaction', () => {
    expect(categorizer.categorize(transaction(''), {}, rules)).toBe('other');
    expect(categorizer.categorize(transaction('הפקדה לא מזוהה', 350), {}, rules)).toBe('income');
  });

  it('gives an explicit user override precedence over learned/default rules', () => {
    const item = transaction('מזונות');
    expect(categorizer.categorize(item, { [item.id!]: 'other' }, rules)).toBe('other');
  });
});
