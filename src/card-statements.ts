import type { BankTransaction, CardBrand } from './domain-model.js';

/* Every charge a household made on one card, gathered the way an issuer's own statement
   gathers them. The dashboard's table answers "what did we spend"; this answers "what is
   on this card" — the question asked when a bill arrives and has to be recognised before
   it is paid. */
export interface CardStatement {
  /** Stable across renders and usable as a select value. The name the household gave the
      card when it imported it, or the brand, or '' for a card it named neither way. Two
      Visas are two cards: grouping by issuer alone put a household's spending on both
      under one heading and under a total neither card was ever charged. */
  readonly key: string;
  readonly brand: CardBrand | undefined;
  /** What the household calls it, when it said. */
  readonly name: string | undefined;
  readonly count: number;
  readonly out: number;
  readonly in: number;
  readonly charges: readonly BankTransaction[];
}

/* Charges newest first inside each card, which is the order every issuer prints and the
   order the dashboard already uses. The cards themselves come back in the order they were
   met; naming them is the caller's job, and so is sorting by a name only it can translate. */
/* The name comes first because it is the only thing that separates two cards from one
   issuer, and it is prefixed so a household that names a card "ויזה" does not merge it
   with the unnamed Visa beside it. */
export function cardKey(transaction: BankTransaction): string {
  return transaction.cardName ? `name:${transaction.cardName}` : transaction.cardBrand ?? '';
}

export function cardStatements(transactions: readonly BankTransaction[]): CardStatement[] {
  const groups = new Map<string, { brand: CardBrand | undefined; name: string | undefined; charges: BankTransaction[] }>();
  for (const transaction of transactions) {
    if (transaction.source !== 'card') continue;
    const key = cardKey(transaction);
    const group = groups.get(key) ?? { brand: transaction.cardBrand, name: transaction.cardName, charges: [] };
    group.charges.push(transaction);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    brand: group.brand,
    name: group.name,
    count: group.charges.length,
    out: group.charges.reduce((sum, charge) => sum + charge.out, 0),
    in: group.charges.reduce((sum, charge) => sum + charge.in, 0),
    charges: [...group.charges].sort((first, second) => (first.date < second.date ? 1 : first.date > second.date ? -1 : 0)),
  }));
}
