import type { FilePayload } from '@playwright/test';

/* The sample workbook carries five transactions across one month, which is enough to
   render the dashboard but not enough to reach the agents that need history: savings
   opportunities, anomalies and the recurring table all stay empty, so accessibility
   and layout checks never see them. This report is deliberately rich enough that every
   agent card and every table has content to render. */

interface Charge {
  readonly desc: string;
  readonly day: number;
  readonly amount: number;
  /** Fixed-price and cancellable, so the subscription agent should claim it. */
  readonly subscription?: boolean;
}

const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08'] as const;

const CHARGES: readonly Charge[] = [
  { desc: 'נטפליקס', day: 4, amount: 54.9, subscription: true },
  { desc: 'ספוטיפיי משפחתי', day: 6, amount: 32.9, subscription: true },
  { desc: 'מנוי חדר כושר הולמס פלייס', day: 8, amount: 249, subscription: true },
  { desc: 'חשמל - חברת החשמל', day: 11, amount: 486 },
  { desc: 'ארנונה עיריית חיפה', day: 2, amount: 612 },
  { desc: 'שופרסל דיל', day: 14, amount: 431 },
  { desc: 'פנגו חניה', day: 19, amount: 62 },
  { desc: 'מכבי שירותי בריאות', day: 16, amount: 318 },
  { desc: 'עמלת ניהול חשבון', day: 3, amount: 27 },
  { desc: 'משיכה מבנקט', day: 21, amount: 400 },
];

const SALARY = 17_400;
const OPENING_BALANCE = 9_200;

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * A four-month Israeli bank statement with recurring charges, fixed-price
 * subscriptions, a duplicated charge and a month-on-month price rise — the
 * conditions every agent needs in order to produce output.
 */
export function richBankReport(): FilePayload {
  const rows: Array<{ date: string; desc: string; out: number; in: number }> = [];

  MONTHS.forEach((month, monthIndex) => {
    rows.push({ date: `${month}-10`, desc: 'משכורת חודשית', out: 0, in: SALARY });
    for (const charge of CHARGES) {
      // Bills drift a little; subscriptions hold their price, which is what separates them.
      const amount = charge.subscription
        ? charge.amount
        : Math.round(charge.amount * (1 + monthIndex * 0.035) * 100) / 100;
      rows.push({ date: `${month}-${pad(charge.day)}`, desc: charge.desc, out: amount, in: 0 });
    }
    // A one-off, so it never looks recurring.
    rows.push({ date: `${month}-23`, desc: `רהיטים והרכבה ${monthIndex + 1}`, out: 260 + monthIndex * 70, in: 0 });
  });

  // A price rise on the last month of one subscription, for the price-increase agent.
  const lastMonth = MONTHS[MONTHS.length - 1]!;
  rows.push({ date: `${lastMonth}-08`, desc: 'מנוי חדר כושר הולמס פלייס', out: 289, in: 0 });
  // The same charge twice inside five days, for the duplicate agent.
  rows.push({ date: `${lastMonth}-06`, desc: 'ספוטיפיי משפחתי', out: 32.9, in: 0 });

  rows.sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));

  let balance = OPENING_BALANCE;
  const lines = ['חשבון,04-279-661711', 'תאריך,תיאור פעולה,חובה,זכות,יתרה'];
  for (const row of rows) {
    balance = Math.round((balance + row.in - row.out) * 100) / 100;
    const [year, month, day] = row.date.split('-') as [string, string, string];
    lines.push([
      `${day}/${month}/${year}`,
      row.desc,
      row.out ? row.out.toFixed(2) : '',
      row.in ? row.in.toFixed(2) : '',
      balance.toFixed(2),
    ].join(','));
  }

  return {
    name: 'rich-statement.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(lines.join('\n'), 'utf-8'),
  };
}
