import { describe, expect, it } from 'vitest';
import { buildFinancialPlan } from '../../src/financial-plan';
import type { BankTransaction } from '../../src/domain-model';

/* The plan is the household's month in the shape a מיפוי worksheet asks for, filled from
   the statements already imported. Nothing on it may be a number nobody can trace back to
   a row: every line is a sum of transactions, and every section adds up to its lines. */

const row = (
  desc: string,
  amounts: { out?: number; in?: number },
  cat: string,
  kind: BankTransaction['kind'] = 'expense',
): BankTransaction => ({
  date: '2026-09-08', vdate: '2026-09-08', ref: '', desc,
  out: amounts.out ?? 0, in: amounts.in ?? 0, bal: null, pending: false,
  source: 'bank', src: 'bank.csv', id: `${desc}-${amounts.out ?? amounts.in}`, cat, kind,
});

const byPayee = (transaction: BankTransaction) => transaction.desc;
const nothingFixed = () => false;

describe('financial plan', () => {
  it('reads a month as income, what leaves, what is set aside and what is left', () => {
    const plan = buildFinancialPlan([
      row('משכורת', { in: 29000 }, 'income', 'income'),
      row('ארנונה עיריית חיפה', { out: 1240 }, 'home'),
      row('שופרסל דיל', { out: 412.3 }, 'food'),
      row('העברה לחיסכון', { out: 2000 }, 'savings', 'neutral'),
    ], (transaction) => transaction.desc === 'ארנונה עיריית חיפה', byPayee);

    expect(plan.income.total).toBe(29000);
    expect(plan.fixed.total).toBe(1240);
    expect(plan.variable.total).toBeCloseTo(412.3, 2);
    expect(plan.savings.total).toBe(2000);
    expect(plan.outgoing).toBeCloseTo(3652.3, 2);
    expect(plan.surplus).toBeCloseTo(25347.7, 2);
  });

  /* Money set aside is not spent, but it is not available either. A plan that counted it
     as neither would report a surplus the household cannot touch. */
  it('counts money moved to savings as money that left', () => {
    const plan = buildFinancialPlan([
      row('משכורת', { in: 10000 }, 'income', 'income'),
      row('העברה לחיסכון', { out: 4000 }, 'savings', 'neutral'),
    ], nothingFixed, byPayee);

    expect(plan.surplus).toBe(6000);
    expect(plan.outgoing).toBe(4000);
  });

  /* Salary and a children's allowance are both `income`. A household reading one line
     called "הכנסות" learns nothing about where its money comes from. */
  it('names income lines by where the money came from, not by the one category they share', () => {
    const plan = buildFinancialPlan([
      row('משכורת', { in: 29000 }, 'income', 'income'),
      row('קצבת ילדים', { in: 1200 }, 'income', 'income'),
      row('משכורת', { in: 1500 }, 'income', 'income'),
    ], nothingFixed, byPayee);

    expect(plan.income.lines).toEqual([
      { key: 'משכורת', amount: 30500, count: 2 },
      { key: 'קצבת ילדים', amount: 1200, count: 1 },
    ]);
  });

  /* Fixed and variable is the question the worksheet asks first, and the answer is not a
     property of the row: a charge is fixed because the same payee came before. */
  it('splits spending by what the caller says already recurs', () => {
    const plan = buildFinancialPlan([
      row('נטפליקס', { out: 54.9 }, 'leisure'),
      row('בית קפה', { out: 42.5 }, 'leisure'),
    ], (transaction) => transaction.desc === 'נטפליקס', byPayee);

    expect(plan.fixed.lines).toEqual([{ key: 'leisure', amount: 54.9, count: 1 }]);
    expect(plan.variable.lines).toEqual([{ key: 'leisure', amount: 42.5, count: 1 }]);
  });

  /* A refund larger than the month's charges leaves a negative line. Dropping it would
     leave a section whose lines do not add up to its own total, which is a worse thing to
     show a household than an awkward line. */
  it('keeps a category whose refunds came to more than its charges', () => {
    const plan = buildFinancialPlan([
      row('חנות ספרים', { out: 130 }, 'leisure'),
      row('חנות ספרים החזר', { in: 200 }, 'leisure'),
    ], nothingFixed, byPayee);

    expect(plan.variable.lines).toEqual([{ key: 'leisure', amount: -70, count: 2 }]);
    expect(plan.variable.total).toBe(-70);
  });

  it('adds every section up to the lines it shows', () => {
    const plan = buildFinancialPlan([
      row('משכורת', { in: 9000 }, 'income', 'income'),
      row('ארנונה', { out: 600 }, 'home'),
      row('חשמל', { out: 400 }, 'home'),
      row('שופרסל', { out: 300 }, 'food'),
    ], (transaction) => transaction.cat === 'home', byPayee);

    for (const section of [plan.income, plan.fixed, plan.variable, plan.savings]) {
      expect(section.lines.reduce((sum, line) => sum + line.amount, 0)).toBeCloseTo(section.total, 2);
    }
    expect(plan.fixed.lines).toEqual([{ key: 'home', amount: 1000, count: 2 }]);
  });

  it('reports an empty month without inventing a figure', () => {
    const plan = buildFinancialPlan([], nothingFixed, byPayee);

    expect(plan.income.lines).toEqual([]);
    expect(plan.surplus).toBe(0);
    expect(plan.outgoing).toBe(0);
  });

  /* A month that spent more than it earned says so with a negative surplus; the screen
     calls it a deficit rather than showing a number that reads as money to spend. */
  it('returns a negative surplus for a month that spent more than it earned', () => {
    const plan = buildFinancialPlan([
      row('משכורת', { in: 4000 }, 'income', 'income'),
      row('משכנתא', { out: 6000 }, 'home'),
    ], () => true, byPayee);

    expect(plan.surplus).toBe(-2000);
  });
});

/* A card settlement on the statement and the card's own charges are the same money
   described twice — the invariant the whole reconciliation rests on. `decorate`
   neutralises the settlement once card detail arrives, and the plan has to keep it out of
   its totals: counted there, a household's card spending is added to its month a second
   time and what is left over comes out short by a full card bill. */
describe('a card settlement once the card detail is in', () => {
  const month = [
    row('משכורת', { in: 29000 }, 'income', 'income'),
    row('ארנונה', { out: 1240 }, 'home'),
    row('סופר יוחננוף', { out: 412.3 }, 'food'),
    row('ויזה כ.א.ל', { out: 4812.37 }, 'credit', 'neutral'),
  ];

  it('is kept out of what left and out of what is left over', () => {
    const plan = buildFinancialPlan(month, nothingFixed, byPayee);

    expect(plan.outgoing).toBeCloseTo(1652.3, 2);
    expect(plan.surplus).toBeCloseTo(27347.7, 2);
  });

  it('is shown on its own rather than filed as money the household set aside', () => {
    const plan = buildFinancialPlan(month, nothingFixed, byPayee);

    expect(plan.settlements.lines).toEqual([{ key: 'credit', amount: 4812.37, count: 1 }]);
    expect(plan.savings.lines).toEqual([]);
  });

  /* A transfer to the household's own savings is neutral too, and it is not a settlement:
     it is money set aside, which the surplus must account for. */
  it('leaves a transfer to savings where it was', () => {
    const plan = buildFinancialPlan([...month, row('העברה לחיסכון', { out: 2000 }, 'savings', 'neutral')], nothingFixed, byPayee);

    expect(plan.savings.total).toBe(2000);
    expect(plan.outgoing).toBeCloseTo(3652.3, 2);
  });

  /* Without card detail imported the settlement is the only record of that spending, and
     `decorate` leaves it an expense — where the plan must count it. */
  it('counts a settlement that is still an expense because no card report arrived', () => {
    const plan = buildFinancialPlan([
      row('משכורת', { in: 29000 }, 'income', 'income'),
      row('ויזה כ.א.ל', { out: 4812.37 }, 'credit'),
    ], nothingFixed, byPayee);

    expect(plan.outgoing).toBeCloseTo(4812.37, 2);
    expect(plan.settlements.lines).toEqual([]);
  });
});
