import type { BankTransaction, Rule } from './domain-model.js';

export interface TransactionCategorizer {
  categorize(transaction: BankTransaction, overrides: Readonly<Record<string, string>>, rules: readonly Rule[]): string;
}

export class RuleBasedTransactionCategorizer implements TransactionCategorizer {
  categorize(transaction: BankTransaction, overrides: Readonly<Record<string, string>>, rules: readonly Rule[]): string {
    const override = transaction.id ? overrides[transaction.id] : undefined;
    if (override) return override;
    const description = transaction.desc.toLocaleLowerCase();
    const direction = transaction.in > 0 ? 'in' : 'out';
    const matched = rules.find((rule) => rule.match && (!rule.when || rule.when === direction)
      && description.includes(rule.match.toLocaleLowerCase()));
    if (matched) return matched.cat;
    return transaction.in > 0 ? 'income' : 'other';
  }
}
