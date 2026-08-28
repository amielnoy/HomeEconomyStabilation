import type { FilePayload } from '@playwright/test';
import { xlsxWorkbook } from '../helpers/workbook-fixtures';

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

/* Several Israeli banks export a file named .xls that is really an HTML document.
   The statement sits inside a layout table, the numbers carry a currency sign and
   thousands separators, and the body is windows-1255 rather than UTF-8 — the three
   things that separate a real bank export from a tidy fixture. */
export function htmlBankReport(): FilePayload {
  const rows = [
    ['01/08/2026', 'שופרסל דיל', '431.00', '', '8,769.00'],
    ['04/08/2026', 'חשמל - חברת החשמל', '486.00', '', '8,283.00'],
    ['10/08/2026', 'משכורת חודשית', '', '17,400.00', '25,683.00'],
    ['14/08/2026', 'משיכה מבנקט', '400.00', '', '25,283.00'],
  ];
  const body = [
    '<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1255"></head><body>',
    '<table><tr><td>',
    '<table>',
    '<tr><td>חשבון</td><td>04-279-661711</td></tr>',
    '<tr><th>תאריך</th><th>תיאור פעולה</th><th>חובה</th><th>זכות</th><th>יתרה</th></tr>',
    ...rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`),
    '</table>',
    '</td></tr></table>',
    '</body></html>',
  ].join('');

  // windows-1255 maps Hebrew U+05D0..U+05EA onto 0xE0..0xFA.
  const bytes = Uint8Array.from([...body].map((character) => {
    const code = character.codePointAt(0)!;
    return code >= 0x05d0 && code <= 0x05ea ? code - 0x05d0 + 0xe0 : code;
  }));

  return { name: 'leumi-statement.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from(bytes) };
}

/* A credit-card export as the issuers actually write one: the columns carry the definite
   article, the transaction amount sits beside the billed amount, and a refund comes back
   as its own row. */
export function issuerCardReport(): FilePayload {
  const lines = [
    'תאריך העסקה,שם בית העסק,קטגוריה,סכום העסקה,סכום החיוב',
    '03/08/2026,שופרסל דיל,מזון,431.00,431.00',
    '07/08/2026,AMAZON US,קניות,40.00,148.20',
    '12/08/2026,נטפליקס,פנאי,54.90,54.90',
    '18/08/2026,החזר רכישה,קניות,-60.00,-60.00',
  ];
  return { name: 'card-statement.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n')) };
}

/* The same statement as SpreadsheetML 2003 — XML named .xls, which is what several
   issuers hand out when the customer asks for Excel. */
export function spreadsheetMlCardReport(): FilePayload {
  const row = (cells: ReadonlyArray<{ value: string; numeric?: boolean }>) => '<Row>'
    + cells.map((c) => `<Cell><Data ss:Type="${c.numeric ? 'Number' : 'String'}">${c.value}</Data></Cell>`).join('')
    + '</Row>';
  const xml = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"'
    + ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="עסקאות"><Table>'
    + row([{ value: 'תאריך העסקה' }, { value: 'שם בית העסק' }, { value: 'סכום החיוב' }])
    + row([{ value: '03/08/2026' }, { value: 'שופרסל דיל' }, { value: '431', numeric: true }])
    + row([{ value: '12/08/2026' }, { value: 'נטפליקס' }, { value: '54.9', numeric: true }])
    + '</Table></Worksheet></Workbook>';
  return { name: 'card-statement.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from(xml) };
}

/* The same statement as a real .xlsx, so the browser drives the zip reader, the
   shared-string table and the style-driven date detection rather than only CSV. */
export function xlsxCardReport(): FilePayload {
  // 46237 and 46241 are 2026-08-03 and 2026-08-07 in the 1900 date system.
  const bytes = xlsxWorkbook([
    [{ value: 'תאריך העסקה', shared: true }, { value: 'שם בית העסק', shared: true }, { value: 'סכום החיוב', shared: true }],
    [{ value: 46237, date: true }, { value: 'שופרסל דיל', shared: true }, { value: 431 }],
    [{ value: 46241, date: true }, { value: 'נטפליקס', shared: true }, { value: 54.9 }],
  ], { sheetName: 'עסקאות' });
  return {
    name: 'card-statement.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(bytes),
  };
}

/* An issuer export in windows-1255, which is what a great many Israeli sites still send.
   Decoded as UTF-8 every merchant name becomes replacement characters, so the import
   succeeds and the month is still unreadable. */
export function windows1255CardReport(): FilePayload {
  const body = '<html><head><meta charset="windows-1255"></head><body><table>'
    + '<tr><td>תאריך עסקה</td><td>שם בית העסק</td><td>סכום חיוב</td></tr>'
    + '<tr><td>03/08/2026</td><td>שופרסל דיל</td><td>431.00</td></tr>'
    + '<tr><td>07/08/2026</td><td>נטפליקס</td><td>54.90</td></tr>'
    + '</table></body></html>';
  const bytes = Uint8Array.from([...body].map((character) => {
    const code = character.codePointAt(0)!;
    // windows-1255 maps Hebrew U+05D0..U+05EA onto 0xE0..0xFA.
    return code >= 0x05d0 && code <= 0x05ea ? code - 0x05d0 + 0xe0 : code;
  }));
  return { name: 'card-1255.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from(bytes) };
}

/* The same .xlsx written without the optional r="A1" cell references, which several
   writers omit and which the reader used to parse into nothing at all. */
export function xlsxCardReportWithoutReferences(): FilePayload {
  const bytes = xlsxWorkbook([
    [{ value: 'תאריך העסקה' }, { value: 'שם בית העסק' }, { value: 'סכום החיוב' }],
    [{ value: '03/08/2026' }, { value: 'שופרסל דיל' }, { value: 431 }],
    [{ value: '07/08/2026' }, { value: 'נטפליקס' }, { value: 54.9 }],
  ], { sheetName: 'עסקאות', omitReferences: true });
  return {
    name: 'card-no-refs.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(bytes),
  };
}
