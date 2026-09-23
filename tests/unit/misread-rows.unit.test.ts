import { describe, expect, it } from 'vitest';
import { asOutgoing, findMisreadRows } from '../../fe/src/misread-rows';
import type { BankTransaction } from '../../fe/src/domain-model';

/* A card report loaded through the statement control was read the wrong way round, and the
   rows it wrote are still in a household's browser: merchant after merchant in green with
   a plus. Finding them is a judgement about someone's saved money, so what it must never
   do is take a salary, an allowance or a refund the bank really did report. */

const row = (input: Partial<BankTransaction> = {}): BankTransaction => ({
  date: '2026-09-06', vdate: '2026-09-06', ref: '', desc: 'APPLE.COM/BILL',
  out: 0, in: 39.8, bal: null, pending: false,
  source: 'bank', src: 'bank-report', id: 'a', cat: 'other', kind: 'expense', ...input,
});

describe('finding rows read the wrong way round', () => {
  it('finds money arriving on a row that never came from a ledger', () => {
    expect(findMisreadRows([row()])).toHaveLength(1);
  });

  /* The balance is what protects real money. A statement row carries the account's balance
     after it; these four all do, and every one of them is money that really arrived. */
  it.each([
    ['a salary the statement reported', row({ desc: 'משכורת', in: 29000, bal: 29000 })],
    ['an allowance', row({ desc: 'קצבת ילדים', in: 1200, bal: 30200 })],
    ['a refund', row({ desc: 'חנות ספרים', in: 130, bal: 9130 })],
    ['a balance of zero the bank did report', row({ in: 100, bal: 0 })],
  ])('leaves %s alone', (_label, transaction) => {
    expect(findMisreadRows([transaction])).toEqual([]);
  });

  it('leaves a row the customer typed by hand alone', () => {
    expect(findMisreadRows([row({ src: 'manual-entry' })])).toEqual([]);
    expect(findMisreadRows([row({ src: 'הזנה ידנית' })])).toEqual([]);
  });

  it('leaves a card row alone, because the card reader read it correctly', () => {
    expect(findMisreadRows([row({ source: 'card', src: 'card-report' })])).toEqual([]);
  });

  it('leaves a row that already reads as spending alone', () => {
    expect(findMisreadRows([row({ out: 39.8, in: 0 })])).toEqual([]);
  });

  /* Both sides filled is a row the reader understood; flipping it would invent a number. */
  it('leaves a row carrying money on both sides alone', () => {
    expect(findMisreadRows([row({ out: 10, in: 39.8 })])).toEqual([]);
  });

  it('moves the money across without touching anything else about the row', () => {
    const corrected = asOutgoing(row({ desc: 'פלאפל הקריה', in: 33 }));

    expect(corrected).toMatchObject({ out: 33, in: 0, desc: 'פלאפל הקריה', date: '2026-09-06' });
  });
});
