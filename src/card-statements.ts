import type { BankTransaction, CardBrand } from './domain-model.js';

/* Every charge a household made on one card, gathered the way an issuer's own statement
   gathers them. The dashboard's table answers "what did we spend"; this answers "what is
   on this card" — the question asked when a bill arrives and has to be recognised before
   it is paid. */
export interface CardStatement {
  /** Stable across renders and usable as a select value: the brand, or '' for a card whose
      issuer the customer declined to name. */
  readonly key: string;
  readonly brand: CardBrand | undefined;
  readonly count: number;
  readonly out: number;
  readonly in: number;
  readonly charges: readonly BankTransaction[];
}

/* Charges newest first inside each card, which is the order every issuer prints and the
   order the dashboard already uses. The cards themselves come back in the order they were
   met; naming them is the caller's job, and so is sorting by a name only it can translate. */
export function cardStatements(transactions: readonly BankTransaction[]): CardStatement[] {
  const groups = new Map<string, { brand: CardBrand | undefined; charges: BankTransaction[] }>();
  for (const transaction of transactions) {
    if (transaction.source !== 'card') continue;
    const key = transaction.cardBrand ?? '';
    const group = groups.get(key) ?? { brand: transaction.cardBrand, charges: [] };
    group.charges.push(transaction);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    brand: group.brand,
    count: group.charges.length,
    out: group.charges.reduce((sum, charge) => sum + charge.out, 0),
    in: group.charges.reduce((sum, charge) => sum + charge.in, 0),
    charges: [...group.charges].sort((first, second) => (first.date < second.date ? 1 : first.date > second.date ? -1 : 0)),
  }));
}
