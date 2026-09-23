import { describe, expect, it } from 'vitest';
import { settlementBills } from '../../fe/src/settlement-bills';
import type { BankTransaction } from '../../fe/src/domain-model';

/* A settlement line on the statement and the charges it paid for are the same money
   described twice, and until now nothing linked one to the other: the app neutralised a
   settlement by a date window and left the household with a figure it could not open.
   The link here is a proof rather than a guess — the charges of one imported report,
   summing exactly to the line, settled inside the window that report could be billed in.
   Where that cannot be shown, nothing is claimed: a total that disagrees with the line it
   hangs under is the defect this is fixing. Structure only, synthetic amounts. */

const charge = (date: string, desc: string, out: number, src: string, inn = 0): BankTransaction => ({
  date, vdate: date, ref: '', desc, out, in: inn, bal: null, pending: false,
  source: 'card', src, id: `${src}:${date}:${desc}`, cat: 'other', kind: 'expense',
});

const settlement = (date: string, out: number, id = `bank:${date}:${out}`): BankTransaction => ({
  date, vdate: date, ref: '', desc: 'ישראכרט בע"מ', out, in: 0, bal: null, pending: false,
  source: 'bank', src: 'bank.xls', id, cat: 'credit', kind: 'neutral',
});

const august = [
  charge('2026-08-04', 'שופרסל דיל', 431.20, 'card-august.xls'),
  charge('2026-08-11', 'פנגו חניה', 62.00, 'card-august.xls'),
  charge('2026-08-19', 'נטפליקס', 54.90, 'card-august.xls'),
];
const augustTotal = 548.10;

describe('linking a settlement to the bill it paid', () => {
  it('opens a settlement onto the report whose charges come to exactly its figure', () => {
    const bills = settlementBills([...august, settlement('2026-09-10', augustTotal, 'sept')]);

    expect([...bills.keys()]).toEqual(['sept']);
    expect(bills.get('sept')).toHaveLength(3);
    const total = bills.get('sept')!.reduce((sum, row) => sum + row.out - row.in, 0);
    expect(total).toBeCloseTo(augustTotal, 2);
  });

  /* A refund on the card reduces the bill, and the household is charged the difference.
     Summing the charges alone read the bill as larger than the bank ever took. */
  it('counts a refund inside the bill rather than against it', () => {
    const withRefund = [...august, charge('2026-08-22', 'זיכוי שופרסל', 0, 'card-august.xls', 31.20)];
    const bills = settlementBills([...withRefund, settlement('2026-09-10', augustTotal - 31.20, 'sept')]);

    expect(bills.get('sept')).toHaveLength(4);
  });

  /* Two bills for the same figure are two explanations of one line, and the app cannot
     say which. It says neither: a household shown the wrong month's charges under a
     settlement would reconcile against a bill it never received. */
  it('claims nothing when two reports could equally explain one line', () => {
    /* Both reports come to the same figure and both are close enough to the settlement to
       have been billed by it. Either is a complete explanation, which is what makes
       choosing one a guess. */
    const second = august.map((row) => ({
      ...row, date: row.date.replace('2026-08-0', '2026-08-2').replace('2026-08-11', '2026-08-26'),
      src: 'card-second.xls', id: 'second' + row.id,
    }));
    const bills = settlementBills([...august, ...second, settlement('2026-09-10', augustTotal, 'sept')]);

    expect(bills.size).toBe(0);
  });

  it('claims nothing for a settlement whose detail was never imported', () => {
    const bills = settlementBills([settlement('2026-09-10', 4812.37, 'sept')]);

    expect(bills.size).toBe(0);
  });

  /* The window is the one the app already settles by: a bill is paid in arrears, but a
     line five months later is a different bill that happens to match a figure. */
  it('does not reach back to a report the settlement is too late to be paying', () => {
    const bills = settlementBills([...august, settlement('2027-02-10', augustTotal, 'late')]);

    expect(bills.size).toBe(0);
  });

  it('does not hand one report to two settlements of the same figure', () => {
    const bills = settlementBills([
      ...august,
      settlement('2026-09-10', augustTotal, 'first'),
      settlement('2026-09-11', augustTotal, 'second'),
    ]);

    expect(bills.size).toBe(0);
  });

  /* Two cards on one statement are two bills. Grouping by the report they arrived in is
     what keeps them apart — the importer writes one file name per report. */
  it('tells two cards apart by the report each arrived in', () => {
    const visa = august.map((row) => ({ ...row, src: 'visa.xls', id: 'visa' + row.id }));
    const isracard = [charge('2026-08-06', 'סופר יוחננוף', 210.00, 'isracard.xls')];
    const bills = settlementBills([
      ...visa, ...isracard,
      settlement('2026-09-10', augustTotal, 'visa-bill'),
      settlement('2026-09-15', 210.00, 'isracard-bill'),
    ]);

    expect(bills.get('visa-bill')).toHaveLength(3);
    expect(bills.get('isracard-bill')).toHaveLength(1);
  });

  it('leaves a bank row that is not a card settlement alone', () => {
    const rent = { ...settlement('2026-09-10', augustTotal, 'rent'), cat: 'home', kind: 'expense' as const, desc: 'שכר דירה' };
    const bills = settlementBills([...august, rent]);

    expect(bills.size).toBe(0);
  });
});
