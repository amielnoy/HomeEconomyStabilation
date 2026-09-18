import { describe, expect, it } from 'vitest';
import { cardStatements } from '../../src/card-statements';
import type { BankTransaction } from '../../src/domain-model';

/* What is on each card, gathered the way an issuer gathers it: the question asked when a
   bill arrives and has to be recognised before it is paid. */

const charge = (date: string, desc: string, out: number, brand?: BankTransaction['cardBrand']): BankTransaction => ({
  date, vdate: date, ref: '', desc, out, in: 0, bal: null, pending: false,
  source: 'card', cardBrand: brand, src: 'card-report', id: `${date}-${desc}`, cat: 'other', kind: 'expense',
});

const statement = (date: string, desc: string, out: number): BankTransaction =>
  ({ ...charge(date, desc, out), source: 'bank', src: 'bank-report', cardBrand: undefined, bal: 100 });

describe('what is on each card', () => {
  it('keeps each issuer apart and totals what it charged', () => {
    const cards = cardStatements([
      charge('2026-09-04', 'סופר יוחננוף', 412.3, 'visa'),
      charge('2026-09-03', 'מוסך הכרמל', 900, 'isracard'),
      charge('2026-09-05', 'נטפליקס', 54.9, 'visa'),
    ]);

    expect(cards.map((card) => [card.key, card.count, Math.round(card.out * 100) / 100]))
      .toEqual([['visa', 2, 467.2], ['isracard', 1, 900]]);
  });

  it('leaves statement rows out: this is what the card charged, not what the account paid', () => {
    const cards = cardStatements([statement('2026-09-06', 'ויזה כ.א.ל', 4812.37), charge('2026-09-04', 'סופר', 412.3, 'visa')]);

    expect(cards).toHaveLength(1);
    expect(cards[0]!.key).toBe('visa');
  });

  /* A card whose issuer the customer declined to name is still one card. */
  it('gathers the charges of an unnamed card without joining them to a named one', () => {
    const cards = cardStatements([charge('2026-09-04', 'א', 10), charge('2026-09-05', 'ב', 20, 'visa'), charge('2026-09-06', 'ג', 30)]);

    expect(cards.map((card) => [card.key, card.count])).toEqual([['', 2], ['visa', 1]]);
  });

  it('prints each card newest first, the way an issuer does', () => {
    const cards = cardStatements([
      charge('2026-09-01', 'ראשון', 10, 'visa'),
      charge('2026-09-09', 'אחרון', 20, 'visa'),
      charge('2026-09-05', 'אמצע', 30, 'visa'),
    ]);

    expect(cards[0]!.charges.map((item) => item.desc)).toEqual(['אחרון', 'אמצע', 'ראשון']);
  });

  it('counts money that came back to the card without subtracting it from what was charged', () => {
    const refund = { ...charge('2026-09-07', 'החזר', 0, 'visa'), in: 60 };
    const cards = cardStatements([charge('2026-09-04', 'חנות', 130, 'visa'), refund]);

    expect(cards[0]).toMatchObject({ out: 130, in: 60, count: 2 });
  });

  it('has nothing to say about a household with no card report', () => {
    expect(cardStatements([statement('2026-09-02', 'משכורת', 0)])).toEqual([]);
  });
});

/* Two Visas are two cards, and no export says which is which — the issuer names the
   company, not the card. Grouping by issuer alone put a household's spending on both under
   one heading, and under a total neither card was ever charged. */
describe('a household with two cards from one issuer', () => {
  const identified = (date: string, desc: string, out: number, last4: string): BankTransaction =>
    ({ ...charge(date, desc, out, 'visa'), cardLast4: last4 });

  it('keeps each identified card apart, and apart from one nobody identified', () => {
    const cards = cardStatements([
      identified('2026-09-04', 'סופר', 412.3, '1234'),
      identified('2026-09-05', 'מוסך', 900, '5678'),
      charge('2026-09-06', 'נטפליקס', 54.9, 'visa'),
    ]);

    expect(cards.map((card) => [card.last4, card.count]))
      .toEqual([['1234', 1], ['5678', 1], [undefined, 1]]);
  });

  it('gathers everything charged to one card under it', () => {
    const cards = cardStatements([
      identified('2026-09-04', 'סופר', 400, '1234'),
      identified('2026-09-07', 'בית קפה', 50, '1234'),
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ last4: '1234', count: 2, out: 450 });
  });

  /* Neither half names a card on its own: two Visas share an issuer, and a Visa and an
     Isracard can end in the same four digits. */
  it('does not merge two issuers that end in the same four digits', () => {
    const cards = cardStatements([
      identified('2026-09-04', 'א', 10, '1234'),
      { ...charge('2026-09-05', 'ב', 20, 'isracard'), cardLast4: '1234' },
    ]);

    expect(cards.map((card) => [card.brand, card.count])).toEqual([['visa', 1], ['isracard', 1]]);
  });
});
