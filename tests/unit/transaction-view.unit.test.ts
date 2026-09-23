import { describe, expect, it } from 'vitest';
import { transactionViewRows, type TransactionViewRow } from '../../fe/src/transaction-view';
import type { BankTransaction, CardBrand } from '../../fe/src/domain-model';

/* The transactions table opens on the account as the bank describes it: the statement
   lines the household recognises, and one line per card carrying the full sum charged.
   These fix what may be folded — a card is folded only where a statement row stands
   beside it to be read against — and that folding never changes the money. */

const bank = (date: string, desc: string, out: number, incoming = 0): BankTransaction => ({
  date, vdate: date, ref: '', desc, out, in: incoming, bal: null, pending: false,
  source: 'bank', src: 'bank.csv', id: `${date}-${desc}`, cat: 'other', kind: 'expense',
});

const charge = (date: string, desc: string, out: number, brand?: CardBrand, cat = 'other'): BankTransaction => ({
  date, vdate: date, ref: '', desc, out, in: 0, bal: null, pending: false,
  source: 'card', cardBrand: brand, src: 'card.csv', id: `${date}-${desc}`, cat, kind: 'expense',
});

const groups = (rows: readonly TransactionViewRow[]) => rows.filter((row) => row.kind === 'card-group');

describe('transaction view rows', () => {
  it('leaves every charge itemised in the every-charge view', () => {
    const rows = transactionViewRows([bank('2026-09-08', 'משכורת', 0, 12000), charge('2026-09-06', 'חנות ספרים', 130, 'visa')], 'every-charge');

    expect(rows.map((row) => row.kind)).toEqual(['transaction', 'transaction']);
  });

  it('folds a card into one line carrying the sum it was charged', () => {
    const rows = transactionViewRows([
      bank('2026-09-08', 'משכורת', 0, 12000),
      charge('2026-09-06', 'חנות ספרים', 130, 'visa'),
      charge('2026-09-04', 'בית קפה', 42.5, 'visa'),
    ], 'bank-with-card-totals');

    expect(rows.map((row) => row.kind)).toEqual(['transaction', 'card-group']);
    const [card] = groups(rows);
    expect(card).toMatchObject({ brand: 'visa', count: 2, in: 0 });
    expect(card!.out).toBeCloseTo(172.5, 2);
  });

  /* Two cards are two lines. Folding them together would report a household one card it
     does not hold, at a sum neither issuer ever charged. */
  it('keeps each issuer on its own line', () => {
    const rows = transactionViewRows([
      bank('2026-09-08', 'שופרסל דיל', 400),
      charge('2026-09-06', 'חנות ספרים', 130, 'visa'),
      charge('2026-09-05', 'מוסך', 900, 'isracard'),
      charge('2026-09-04', 'בית קפה', 42.5, 'visa'),
    ], 'bank-with-card-totals');

    expect(groups(rows).map((card) => [card.brand, card.count])).toEqual([['visa', 2], ['isracard', 1]]);
  });

  /* A card whose issuer the customer declined to name is still one card, not one line
     per charge — and must not be folded in with a named one. */
  it('folds the charges of an unnamed card without joining them to a named issuer', () => {
    const rows = transactionViewRows([
      bank('2026-09-08', 'שופרסל דיל', 400),
      charge('2026-09-06', 'חנות ספרים', 130),
      charge('2026-09-05', 'מוסך', 900, 'visa'),
      charge('2026-09-04', 'בית קפה', 42.5),
    ], 'bank-with-card-totals');

    expect(groups(rows).map((card) => [card.key, card.count])).toEqual([['', 2], ['visa', 1]]);
  });

  /* Without a statement in the list there is no settlement line the charges are being
     read against, and folding them would leave a household looking at a table that says
     nothing about what it spent. */
  it('itemises card charges when no statement row stands beside them', () => {
    const rows = transactionViewRows([
      charge('2026-09-06', 'חנות ספרים', 130, 'visa'),
      charge('2026-09-04', 'בית קפה', 42.5, 'visa'),
    ], 'bank-with-card-totals');

    expect(rows.map((row) => row.kind)).toEqual(['transaction', 'transaction']);
  });

  /* A refund arrives on the card it was charged to, so it belongs in the same fold —
     counted as money returning rather than subtracted from the spending silently. */
  it('carries a refund into the card it arrived on', () => {
    const refund = { ...charge('2026-09-05', 'החזר', 0, 'visa'), in: 60 };
    const rows = transactionViewRows([bank('2026-09-08', 'שופרסל דיל', 400), charge('2026-09-06', 'חנות ספרים', 130, 'visa'), refund], 'bank-with-card-totals');

    expect(groups(rows)[0]).toMatchObject({ count: 2, out: 130, in: 60 });
  });

  /* The summary stands where the card's month ends, so it sorts among the statement rows
     rather than falling to the oldest charge it covers. */
  it('dates a card line by its newest charge', () => {
    const rows = transactionViewRows([
      bank('2026-09-09', 'שופרסל דיל', 400),
      charge('2026-09-06', 'חנות ספרים', 130, 'visa'),
      charge('2026-08-30', 'בית קפה', 42.5, 'visa'),
    ], 'bank-with-card-totals');

    expect(groups(rows)[0]!.date).toBe('2026-09-06');
  });

  it('keeps the statement rows in the order they arrived', () => {
    const rows = transactionViewRows([
      bank('2026-09-09', 'שופרסל דיל', 400),
      charge('2026-09-06', 'חנות ספרים', 130, 'visa'),
      bank('2026-09-02', 'משכורת', 0, 12000),
    ], 'bank-with-card-totals');

    expect(rows.map((row) => (row.kind === 'transaction' ? row.transaction.desc : 'card'))).toEqual(['שופרסל דיל', 'card', 'משכורת']);
  });
});
