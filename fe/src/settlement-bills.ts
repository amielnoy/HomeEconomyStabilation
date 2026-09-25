import type { BankTransaction } from './domain-model.js';

/* Which charges a settlement line paid for. The statement says a card company took a sum
   on a date and nothing else; the card report says what the household bought and never
   names the debit that covered it. Nothing in either file links the two, so the link has
   to be earned — and where it cannot be, this says so by leaving the settlement out.
   A household opening a bill is reconciling: a list that comes to a different figure than
   the line it hangs under is worse than no list, because it looks like an answer. */

/* A card period is settled in arrears — the same window `decorate` neutralises by, for
   the same reason. Past it, a figure that matches is a different bill that happens to
   agree. */
const DAY = 86_400_000;
const SETTLEMENT_WINDOW_DAYS = 45;

/* Money compares to the agora. Summing floats drifts below that, and a bill that missed
   its settlement by a hundredth of a shekel would go unexplained for a rounding error. */
const AGORA = 0.005;

const at = (date: string) => new Date(date + 'T00:00:00').getTime();

/* What the household was actually billed: charges less anything refunded onto the card in
   the same period. A refund reduces the bill, and summing the charges alone read the bill
   as larger than the bank ever took. */
const billed = (charges: readonly BankTransaction[]) =>
  charges.reduce((sum, charge) => sum + charge.out - charge.in, 0);

/* One report is one bill. The importer writes the file name onto every row it reads, so
   the rows of a report are already a set — and two cards imported separately stay two
   sets, which is what keeps a Visa's bill off an Isracard's line. */
function reportsByCard(transactions: readonly BankTransaction[]): Map<string, BankTransaction[]> {
  const reports = new Map<string, BankTransaction[]>();
  for (const transaction of transactions) {
    if (transaction.source !== 'card') continue;
    const report = reports.get(transaction.src) ?? [];
    report.push(transaction);
    reports.set(transaction.src, report);
  }
  return reports;
}

/**
 * Settlement rows that can be opened, by the id of the row, mapped to the charges that
 * bill paid for. A settlement appears only when exactly one imported report comes to its
 * figure and could have been billed by it; anything ambiguous, unmatched or unexplained
 * is absent rather than guessed.
 */
export function settlementBills(
  transactions: readonly BankTransaction[],
): Map<string, readonly BankTransaction[]> {
  const reports = reportsByCard(transactions);
  if (!reports.size) return new Map();

  const settlements = transactions.filter(
    (transaction) => transaction.source !== 'card' && transaction.cat === 'credit'
      && transaction.out > 0 && transaction.id,
  );

  /* Every pairing that holds, before any of them is taken. A report that two settlements
     could pay, or a settlement two reports could explain, is an open question — and the
     app answers open questions by not answering them. Deciding pair by pair instead would
     hand the first settlement met a report the second had an equal claim to, which is a
     guess wearing the clothes of a proof. */
  const claims: Array<{ settlement: string; report: string }> = [];
  for (const settlement of settlements) {
    const when = at(settlement.date);
    for (const [src, charges] of reports) {
      if (Math.abs(billed(charges) - settlement.out) > AGORA) continue;
      const newest = charges.reduce((latest, charge) => (charge.date > latest ? charge.date : latest), charges[0]!.date);
      const opened = at(newest);
      if (when < opened || when > opened + SETTLEMENT_WINDOW_DAYS * DAY) continue;
      claims.push({ settlement: settlement.id!, report: src });
    }
  }

  const settlementClaims = new Map<string, number>();
  const reportClaims = new Map<string, number>();
  for (const claim of claims) {
    settlementClaims.set(claim.settlement, (settlementClaims.get(claim.settlement) ?? 0) + 1);
    reportClaims.set(claim.report, (reportClaims.get(claim.report) ?? 0) + 1);
  }

  const bills = new Map<string, readonly BankTransaction[]>();
  for (const claim of claims) {
    if (settlementClaims.get(claim.settlement) !== 1 || reportClaims.get(claim.report) !== 1) continue;
    /* Newest first, the order every issuer prints and the order the table already uses. */
    bills.set(claim.settlement, [...reports.get(claim.report)!]
      .sort((first, second) => (first.date < second.date ? 1 : first.date > second.date ? -1 : 0)));
  }
  return bills;
}
