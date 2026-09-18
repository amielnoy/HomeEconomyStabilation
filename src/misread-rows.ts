import type { BankTransaction } from './domain-model.js';

/* Rows a household is already looking at, saved before the reader recognised a card report
   loaded through the statement control. On that path the file's one amount column means
   money arriving, so a month of spending was saved as a month of income. The reader knows
   the file now, but the rows it already wrote are still wrong, and a household should not
   have to delete everything it has to be rid of them.
 *
 * What identifies them, and why each condition is needed:
 *  - money arriving and nothing leaving, which is the shape the misreading produces;
 *  - no running balance. A statement row carries the account's balance after it; a row
 *    saved without one never came from a ledger. This is the condition that protects a
 *    salary, an allowance or a refund the bank really did report;
 *  - not a card row, which was read correctly;
 *  - not typed by hand, because a household that entered money it received meant it.
 */
const MANUAL_SOURCES = new Set(['manual-entry', 'הזנה ידנית']);

export function findMisreadRows(transactions: readonly BankTransaction[]): BankTransaction[] {
  return transactions.filter((transaction) =>
    transaction.source !== 'card'
    && transaction.in > 0
    && transaction.out === 0
    && transaction.bal === null
    && !MANUAL_SOURCES.has(transaction.src));
}

/** The same row with the money on the income side, for a charge the reader filed as
    spending — a refund, a reimbursement, money a household was sent. */
export function asIncoming(transaction: BankTransaction): BankTransaction {
  return { ...transaction, in: transaction.out, out: 0 };
}

/** The same row with the money on the side it belongs. Nothing else about it changes: the
    date, the description and the amount are what the file said, and only the direction was
    ever in question. */
export function asOutgoing(transaction: BankTransaction): BankTransaction {
  return { ...transaction, out: transaction.in, in: 0 };
}
