import { Blob as NodeBlob } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bankImporter } from '../../src/bank-importer';
import { creditCardImporter, describeColumns } from '../../src/credit-card-importer';
import { readWorkbook } from '../../src/spreadsheet-reader';
import { spreadsheetMl, toArrayBuffer, xlsxWorkbook } from '../helpers/workbook-fixtures';

/* The unit tests hand the importers a workbook that was never read from a file, and the
   browser tests drive the whole application. Between them sits the join nobody covered:
   raw bytes through the reader and into the importer. Every card-import failure reported
   so far lived exactly there — a container the reader mishandled, or a heading the
   importer did not know, with each half passing its own tests. */

/* Inflating a real .xlsx needs Blob.stream(), which jsdom does not provide. */
(globalThis as unknown as { Blob: unknown }).Blob = NodeBlob;

const root = resolve(__dirname, '../..');

const HEADINGS = ['תאריך העסקה', 'שם בית העסק', 'סכום החיוב'] as const;

describe('import pipeline: bytes through the reader into the importer', () => {
  it('carries a CSV export from bytes to transactions', async () => {
    const workbook = await readWorkbook(toArrayBuffer(
      `${HEADINGS.join(',')}\n03/08/2026,שופרסל דיל,431.00\n07/08/2026,נטפליקס,54.90`,
    ), 'card.csv');

    const rows = creditCardImporter.import(workbook, 'card.csv');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-08-03', desc: 'שופרסל דיל', out: 431, source: 'card' });
    expect(rows[1]).toMatchObject({ date: '2026-08-07', out: 54.9 });
  });

  it('carries a SpreadsheetML export named .xls from bytes to transactions', async () => {
    const workbook = await readWorkbook(toArrayBuffer(spreadsheetMl([
      HEADINGS.map((value) => ({ value })),
      [{ value: '03/08/2026' }, { value: 'שופרסל דיל' }, { value: '431', type: 'Number' }],
    ], { sheetName: 'עסקאות' })), 'card.xls');

    const rows = creditCardImporter.import(workbook, 'card.xls');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: '2026-08-03', desc: 'שופרסל דיל', out: 431 });
  });

  it('carries an HTML table shipped under an .xls name from bytes to transactions', async () => {
    const cells = (values: readonly string[]) => `<tr>${values.map((value) => `<td>${value}</td>`).join('')}</tr>`;
    const workbook = await readWorkbook(toArrayBuffer(
      `<html><body><table>${cells(HEADINGS)}${cells(['03/08/2026', 'שופרסל דיל', '431.00'])}</table></body></html>`,
    ), 'card.xls');

    const rows = creditCardImporter.import(workbook, 'card.xls');

    expect(rows[0]).toMatchObject({ date: '2026-08-03', desc: 'שופרסל דיל', out: 431 });
  });

  it('carries an .xlsx from bytes to transactions, dates and all', async () => {
    const workbook = await readWorkbook(xlsxWorkbook([
      HEADINGS.map((value) => ({ value, shared: true })),
      // 46237 is 2026-08-03 in the 1900 date system.
      [{ value: 46237, date: true }, { value: 'שופרסל דיל', shared: true }, { value: 431 }],
    ], { sheetName: 'עסקאות' }), 'card.xlsx');

    const rows = creditCardImporter.import(workbook, 'card.xlsx');

    expect(rows[0]).toMatchObject({ date: '2026-08-03', desc: 'שופרסל דיל', out: 431 });
  });

  it('carries the legacy .xls fixture through the statement importer', async () => {
    const bytes = new Uint8Array(readFileSync(resolve(root, 'home_economy.xls'))).buffer as ArrayBuffer;

    const workbook = await readWorkbook(bytes, 'home_economy.xls');
    const { rows, account } = bankImporter.import(workbook, 'home_economy.xls');

    expect(account).toBe('04-279-661711');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date))).toBe(true);
    expect(rows.every((row) => row.source === 'bank')).toBe(true);
  });

  /* The card control falls back to the statement reader when the strict card strategy
     rejects a layout, so a statement-shaped file chosen there still has to import — and
     has to be booked as card spending rather than as bank activity. */
  it('imports a statement-shaped file chosen through the card control', async () => {
    const workbook = await readWorkbook(toArrayBuffer(
      'תאריך,תיאור פעולה,חובה,יתרה\n03/08/2026,שופרסל דיל,431.00,5000',
    ), 'statement.csv');

    const { rows } = bankImporter.import(workbook, 'statement.csv', 'card');

    expect(rows[0]).toMatchObject({ desc: 'שופרסל דיל', out: 431, source: 'card' });
  });

  /* Israeli exports are commonly windows-1255. Decoding one as UTF-8 replaces every
     Hebrew merchant name with U+FFFD, which then matches no categorisation rule and
     lands the whole month in "other" — an import that succeeds and is still useless. */
  it('keeps Hebrew merchant names through a windows-1255 card export', async () => {
    const body = '<html><head><meta charset="windows-1255"></head><body><table>'
      + '<tr><td>תאריך עסקה</td><td>שם בית העסק</td><td>סכום חיוב</td></tr>'
      + '<tr><td>03/08/2026</td><td>שופרסל</td><td>431</td></tr>'
      + '</table></body></html>';
    const bytes = new Uint8Array([...body].map((character) => {
      const code = character.codePointAt(0)!;
      return code >= 0x05d0 && code <= 0x05ea ? code - 0x05d0 + 0xe0 : code;
    }));

    const workbook = await readWorkbook(bytes.buffer as ArrayBuffer, 'card.xls');
    const rows = creditCardImporter.import(workbook, 'card.xls');

    expect(rows[0]).toMatchObject({ desc: 'שופרסל', out: 431 });
    expect(rows[0]!.desc).not.toContain('\ufffd');
  });

  /* r="A1" is optional in the .xlsx format. Writers that omit it produced a workbook the
     reader parsed into nothing, which reached the customer as an empty report. */
  it('imports an .xlsx whose writer omitted the optional cell references', async () => {
    const workbook = await readWorkbook(xlsxWorkbook([
      HEADINGS.map((value) => ({ value })),
      [{ value: '03/08/2026' }, { value: 'שופרסל דיל' }, { value: 431 }],
    ], { omitReferences: true }), 'no-refs.xlsx');

    const rows = creditCardImporter.import(workbook, 'no-refs.xlsx');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: '2026-08-03', desc: 'שופרסל דיל', out: 431 });
  });

  /* A SpreadsheetML date carries no timezone. Read as local time it lands on the previous
     day everywhere east of UTC, quietly moving every charge into the wrong month. */
  it('keeps a SpreadsheetML date on its own calendar day', async () => {
    const workbook = await readWorkbook(toArrayBuffer(spreadsheetMl([
      HEADINGS.map((value) => ({ value })),
      [{ value: '2026-08-01T00:00:00.000', type: 'DateTime' }, { value: 'שופרסל' }, { value: '431', type: 'Number' }],
    ])), 'dates.xls');

    const rows = creditCardImporter.import(workbook, 'dates.xls');

    expect(rows[0]!.date).toBe('2026-08-01');
  });

  /* When the layout is not recognised the customer is shown the columns that were found,
     so that description has to survive the reader rather than being derived from a
     workbook someone typed into a test. */
  it('describes the heading row of a real file the importer cannot read', async () => {
    const workbook = await readWorkbook(toArrayBuffer(
      'כרטיס,1234\nעמודה א,עמודה ב,עמודה ג\n1,2,3',
    ), 'mystery.csv');

    expect(() => creditCardImporter.import(workbook, 'mystery.csv')).toThrow();
    expect(describeColumns(workbook)).toBe('עמודה א · עמודה ב · עמודה ג');
  });

  /* The shape a real issuer export actually has, and the one that defeated every earlier
     fixture: compressed, its table starting well below the first row, and several blocks
     on one sheet each with their own headings and column order. Read as one table it threw
     on the first unwritten row, and once that was survived it mapped a due-date column as
     the amount and imported nothing at all. */
  it('imports a compressed multi-block export whose table starts low', async () => {
    const workbook = await readWorkbook(xlsxWorkbook([
      [{ value: 'חיובים קרובים' }],
      [{ value: 'מספר חשבון 12-729-74821' }],
      [],
      [{ value: 'רכישות בארץ' }],
      [{ value: 'שם כרטיס' }, { value: 'חיוב לתאריך' }, { value: 'תאריך' }, { value: 'שם בית עסק' }, { value: "סכום חיוב בש''ח" }, { value: 'אסמכתא' }],
      [{ value: '8677' }, { value: 46266, date: true }, { value: 46237, date: true }, { value: 'סופר' }, { value: 19.9 }, { value: '151004651922873380' }],
      [],
      [{ value: "רכישות בחו''ל" }],
      // The same figures under a different column order, which is what collapsed two
      // distinct charges onto one id before each block kept its own mapping.
      [{ value: 'תאריך' }, { value: 'אסמכתא' }, { value: 'שם בית עסק' }, { value: 'סכום חיוב' }],
      [{ value: 46237, date: true }, { value: '723023360780180008' }, { value: 'סופר' }, { value: 19.9 }],
    ], { deflate: true, startRow: 2, sheetName: 'גיליון1' }), 'card.xlsx');

    const rows = creditCardImporter.import(workbook, 'card.xlsx');

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.date === '2026-08-03')).toBe(true);
    expect(rows.every((row) => row.out === 19.9)).toBe(true);
    expect(rows.map((row) => row.ref)).toEqual(['151004651922873380', '723023360780180008']);
    // Distinct references, so neither charge is taken for a duplicate of the other.
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });

  /* The two uploads are separate controls, separate importers and separate column
     vocabularies, but they land in one list that has to agree about what a row means. The
     tests below run a statement and a card export through the same pipeline together. */
  it('imports a statement and a card export from the same container shape', async () => {
    const statement = await readWorkbook(xlsxWorkbook([
      [{ value: 'תאריך' }, { value: 'תיאור פעולה' }, { value: 'חובה' }, { value: 'זכות' }, { value: 'יתרה' }],
      [{ value: '03/08/2026' }, { value: 'שופרסל' }, { value: 431 }, null, { value: 9000 }],
    ], { deflate: true, startRow: 3, sheetName: 'עובר ושב' }), 'bank.xlsx');
    const card = await readWorkbook(xlsxWorkbook([
      [{ value: 'תאריך עסקה' }, { value: 'שם בית עסק' }, { value: 'סכום חיוב' }],
      [{ value: '03/08/2026' }, { value: 'נטפליקס' }, { value: 54.9 }],
    ], { deflate: true, startRow: 3, sheetName: 'עסקאות' }), 'card.xlsx');

    const bankRows = bankImporter.import(statement, 'bank.xlsx').rows;
    const cardRows = creditCardImporter.import(card, 'card.xlsx');

    expect(bankRows).toHaveLength(1);
    expect(cardRows).toHaveLength(1);
    expect(bankRows[0]!.source).toBe('bank');
    expect(cardRows[0]!.source).toBe('card');
  });

  /* The two sources spell an outgoing charge differently: a statement puts it in its own
     debit column, a card export writes one signed number where a minus means a refund. */
  it('reads an outgoing charge correctly from each source convention', async () => {
    const statement = await readWorkbook(toArrayBuffer(
      'תאריך,תיאור פעולה,חובה,זכות\n03/08/2026,שופרסל,431,\n04/08/2026,משכורת,,17400',
    ), 'bank.csv');
    const card = await readWorkbook(toArrayBuffer(
      'תאריך עסקה,שם בית עסק,סכום חיוב\n03/08/2026,שופרסל,431\n04/08/2026,החזר,-60',
    ), 'card.csv');

    const bankRows = bankImporter.import(statement, 'bank.csv').rows;
    const cardRows = creditCardImporter.import(card, 'card.csv');

    expect(bankRows.map((row) => [row.out, row.in])).toEqual([[431, 0], [0, 17400]]);
    expect(cardRows.map((row) => [row.out, row.in])).toEqual([[431, 0], [0, 60]]);
  });

  /* An account belongs to the statement it was read from. Attributing one to a card export
     would put the customer's account number against rows that never came from it. */
  it('takes an account number from a statement and never from a card export', async () => {
    const statement = await readWorkbook(toArrayBuffer(
      'חשבון,04-279-661711\nתאריך,תיאור פעולה,חובה,יתרה\n03/08/2026,שופרסל,431,9000',
    ), 'bank.csv');
    const card = await readWorkbook(toArrayBuffer(
      'תאריך עסקה,שם בית עסק,סכום חיוב\n03/08/2026,נטפליקס,54.9',
    ), 'card.csv');

    expect(bankImporter.import(statement, 'bank.csv').account).toBe('04-279-661711');
    // The card path returns rows only; nothing about it can carry an account.
    expect(creditCardImporter.import(card, 'card.csv').every((row) => row.source === 'card')).toBe(true);
  });

  /* Both uploads feed one dashboard, so a row from either has to answer the same questions
     about itself — and re-reading either file has to produce the ids it produced before. */
  it('gives the dashboard the same row shape from both uploads', async () => {
    const bytes = {
      bank: () => toArrayBuffer('תאריך,תיאור פעולה,חובה,יתרה\n03/08/2026,שופרסל,431,9000'),
      card: () => toArrayBuffer('תאריך עסקה,שם בית עסק,סכום חיוב\n03/08/2026,נטפליקס,54.9'),
    };
    const read = async () => ({
      bank: bankImporter.import(await readWorkbook(bytes.bank(), 'b.csv'), 'b.csv').rows,
      card: creditCardImporter.import(await readWorkbook(bytes.card(), 'c.csv'), 'c.csv'),
    });

    const first = await read();
    const second = await read();

    const fields = ['id', 'date', 'vdate', 'ref', 'desc', 'out', 'in', 'bal', 'pending', 'source', 'src'];
    for (const row of [first.bank[0]!, first.card[0]!]) {
      expect(Object.keys(row).sort()).toEqual([...fields].sort());
    }
    expect(first.bank[0]!.id).toBe(second.bank[0]!.id);
    expect(first.card[0]!.id).toBe(second.card[0]!.id);
  });

  /* An issuer export that defeated the reader and the importer in turn: every element
     namespace-prefixed, so no sheet was found at all and the customer was told the file
     could not be opened; then a date column headed "תאריך רכישה", which no pattern knew, so
     the layout was refused. Both halves are exercised here together, because passing one
     and failing the other still leaves the customer with nothing. */
  it('imports a prefixed .xlsx whose date column is the purchase date', async () => {
    const workbook = await readWorkbook(xlsxWorkbook([
      [{ value: 'פירוט עסקאות' }],
      [],
      [{ value: 'תאריך רכישה' }, { value: 'שם בית עסק' }, { value: 'סכום עסקה' },
        { value: 'מטבע עסקה' }, { value: 'סכום חיוב' }, { value: "מס' שובר" }],
      [{ value: '26/08/2026' }, { value: 'שופרסל' }, { value: 431 },
        { value: 'ILS' }, { value: 431 }, { value: '12345678' }],
      [{ value: '27/08/2026' }, { value: 'נטפליקס' }, { value: 54.9 },
        { value: 'ILS' }, { value: 54.9 }, { value: '87654321' }],
    ], { prefixed: true, deflate: true, startRow: 1, sheetName: 'פירוט עסקאות' }), 'isracard.xlsx');

    const rows = creditCardImporter.import(workbook, 'isracard.xlsx');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-08-26', desc: 'שופרסל', out: 431, ref: '12345678' });
    // The billed column, not the transaction currency beside it.
    expect(rows.reduce((total, row) => total + row.out, 0)).toBeCloseTo(485.9, 2);
  });

  /* Re-importing the same download is the most ordinary thing a customer does; the ids
     have to collide so the second import adds nothing. */
  it('produces identical ids when the same export is read twice', async () => {
    const bytes = () => toArrayBuffer(`${HEADINGS.join(',')}\n03/08/2026,שופרסל דיל,431.00`);

    const first = creditCardImporter.import(await readWorkbook(bytes(), 'card.csv'), 'card.csv');
    const second = creditCardImporter.import(await readWorkbook(bytes(), 'card.csv'), 'card.csv');

    expect(first[0]!.id).toBe(second[0]!.id);
  });
});
