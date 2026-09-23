import { describe, expect, it } from 'vitest';
import { RuleBasedTransactionCategorizer } from '../../fe/src/categorization';
import type { BankTransaction, Rule } from '../../fe/src/domain-model';

const transaction = (desc: string, incoming = 0): BankTransaction => ({
  date: '2026-08-09', vdate: '2026-08-09', ref: '', desc, out: incoming ? 0 : 100,
  in: incoming, bal: null, pending: false, source: 'bank', src: 'bank-report', id: desc,
});
const rules: Rule[] = [
  { id: 'transfer', match: 'משיכה לחשבון הבנק', cat: 'savings' },
  { id: 'alimony', match: 'מזונות', cat: 'alimony', when: 'out' },
];

describe('rule-based transaction categorization', () => {
  const categorizer = new RuleBasedTransactionCategorizer();

  it.each([
    ['המבצע: עמיאל פלד עבור: משיכה לחשבון הבנק', 'savings'],
    ['לטובת: אסתר אושרית פלד עבור: מזונות', 'alimony'],
  ])('classifies %s as %s from descriptive evidence', (description, expected) => {
    expect(categorizer.categorize(transaction(description), {}, rules)).toBe(expected);
  });

  it('keeps an unexplained debit as other and recognizes an incoming transaction', () => {
    expect(categorizer.categorize(transaction(''), {}, rules)).toBe('other');
    expect(categorizer.categorize(transaction('הפקדה לא מזוהה', 350), {}, rules)).toBe('income');
  });

  /* Maintenance arriving is the receiving household's income. Filed into the expense
     category that the paying household's rule names, it would be subtracted from the
     month it was meant to cover. */
  it('leaves maintenance arriving as income rather than as the expense it is for the payer', () => {
    expect(categorizer.categorize(transaction('מזונות', 3000), {}, rules)).toBe('income');
  });

  it('gives an explicit user override precedence over learned/default rules', () => {
    const item = transaction('מזונות');
    expect(categorizer.categorize(item, { [item.id!]: 'other' }, rules)).toBe('other');
  });

  /* The same wording arrives and leaves: ביטוח לאומי pays an allowance in and collects a
     contribution out. A rule that names a direction must decline the other one and let a
     later rule answer, rather than filing a payment as income. */
  describe('a rule that names a direction', () => {
    const directed: Rule[] = [
      { id: 'allowance', match: 'ביטוח לאומי', cat: 'income', when: 'in' },
      { id: 'insurance', match: 'ביטוח', cat: 'health' },
    ];

    it('claims the direction it names', () => {
      expect(categorizer.categorize(transaction('ביטוח לאומי קצבת ילדים', 450), {}, directed)).toBe('income');
    });

    it('declines the other direction and leaves it to the next rule', () => {
      expect(categorizer.categorize(transaction('ביטוח לאומי מקדמה'), {}, directed)).toBe('health');
    });

    it('does not shadow an undirected rule that would have matched', () => {
      expect(categorizer.categorize(transaction('ביטוח בריאות פרטי'), {}, directed)).toBe('health');
    });
  });
});
