import type { BankTransaction, CardBrand } from './domain-model.js';
import { cardKey } from './card-statements.js';

/* How the transactions table reads a household that imported both a statement and card
   detail. The default is `bank-with-card-totals`, because that is the account as the bank
   describes it: the statement lines the household recognises, and one line for each card
   carrying the full sum it was charged — the same shape the settlement line has on the
   statement itself. `every-charge` opens each card back into its line items. */
export type TransactionViewMode = 'bank-with-card-totals' | 'every-charge';

export interface CardChargeGroup {
  readonly kind: 'card-group';
  /** Stable across renders so an opened card stays open; the brand, or '' when unnamed. */
  readonly key: string;
  readonly brand: CardBrand | undefined;
  readonly name: string | undefined;
  /** The newest charge in the group, so the summary sorts where the card's month ends. */
  readonly date: string;
  readonly count: number;
  readonly out: number;
  readonly in: number;
  readonly charges: readonly BankTransaction[];
}

export interface SingleTransactionRow {
  readonly kind: 'transaction';
  readonly transaction: BankTransaction;
}

export type TransactionViewRow = SingleTransactionRow | CardChargeGroup;

const asRow = (transaction: BankTransaction): SingleTransactionRow => ({ kind: 'transaction', transaction });

/* Card detail and the settlement line that pays for it are the same money described
   twice, which is why `decorate` already neutralises the settlement once detail arrives.
   The summary view says the same thing on screen: the charges fold into one line per card.
   Where no statement row is in the list there is nothing the charges are being read
   against — a card-only household, or a filter that left only card rows — and folding
   them would leave a table that shows a household nothing of what it spent. So the fold
   happens only beside bank rows; anything else is itemised. */
export function transactionViewRows(
  list: readonly BankTransaction[],
  mode: TransactionViewMode,
): TransactionViewRow[] {
  if (mode === 'every-charge') return list.map(asRow);
  if (!list.some((transaction) => transaction.source !== 'card')) return list.map(asRow);

  const groups = new Map<string, { charges: BankTransaction[]; brand: CardBrand | undefined; name: string | undefined }>();
  const rows: Array<SingleTransactionRow | { kind: 'placeholder'; key: string }> = [];
  for (const transaction of list) {
    if (transaction.source !== 'card') { rows.push(asRow(transaction)); continue; }
    /* The same key the cards screen groups by: two Visas fold into two lines, not one. */
    const key = cardKey(transaction);
    const group = groups.get(key);
    if (group) { group.charges.push(transaction); continue; }
    groups.set(key, { charges: [transaction], brand: transaction.cardBrand, name: transaction.cardName });
    rows.push({ kind: 'placeholder', key });
  }

  return rows.map((row) => {
    if (row.kind === 'transaction') return row;
    const group = groups.get(row.key)!;
    return {
      kind: 'card-group',
      key: row.key,
      brand: group.brand,
      name: group.name,
      date: group.charges.reduce((latest, charge) => (charge.date > latest ? charge.date : latest), group.charges[0]!.date),
      count: group.charges.length,
      out: group.charges.reduce((sum, charge) => sum + charge.out, 0),
      in: group.charges.reduce((sum, charge) => sum + charge.in, 0),
      charges: group.charges,
    };
  });
}
