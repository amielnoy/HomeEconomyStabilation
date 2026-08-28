import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { creditCardImporter, type TransactionRecord, type Workbook } from '../../src/credit-card-importer';
import { readWorkbook } from '../../src/spreadsheet-reader';
import { spreadsheetMl, toArrayBuffer, xlsxWorkbook } from '../helpers/workbook-fixtures';

const root = resolve(__dirname, '../..');

const contractWorkbook: Workbook = {
  sheets: [{
    name: 'monthly-card-export',
    rows: [
      [{ t: 's', v: 'תאריך' }, { t: 's', v: 'בית עסק' }, { t: 's', v: 'סכום עסקה' }],
      [{ t: 's', v: '15/08/2026' }, { t: 's', v: 'ספק' }, { t: 'n', v: 99 }],
    ],
  }],
};

const requiredKeys: Array<keyof TransactionRecord> = [
  'id', 'date', 'vdate', 'ref', 'desc', 'out', 'in', 'bal', 'pending', 'source', 'src',
];

describe('importer transaction contract', () => {
  it('keeps the transaction shape consumed by the dashboard', () => {
    const [transaction] = creditCardImporter.import(contractWorkbook, 'monthly.xls');

    expect(Object.keys(transaction).sort()).toEqual([...requiredKeys].sort());
    expect(transaction.source).toBe('card');
    expect(transaction.out + transaction.in).toBeGreaterThan(0);
  });

  /* Every reader feeds the same importers, so they owe them the same shape. A hole in
     a row is not an empty row: the importers index into each row they walk, so one
     sparse array from any reader is a crash on a real customer's file. */
  it('gives the importers dense rows whatever the file format was', async () => {
    const files: Array<[string, ArrayBuffer]> = [
      ['card.csv', toArrayBuffer('תאריך עסקה,שם בית עסק,סכום חיוב\n03/08/2026,שופרסל,431')],
      ['card.xls', toArrayBuffer('<table><tr><td>תאריך עסקה</td><td>שם בית עסק</td></tr><tr><td>03/08/2026</td><td>שופרסל</td></tr></table>')],
      ['card-ml.xls', toArrayBuffer(spreadsheetMl([
        [{ value: 'תאריך עסקה' }, { value: 'שם בית עסק' }],
        [{ value: '03/08/2026' }, { value: 'שופרסל' }],
      ]))],
      ['card.xlsx', xlsxWorkbook([[{ value: 'תאריך עסקה' }, { value: 'שם בית עסק' }]])],
      ['home_economy.xls', new Uint8Array(readFileSync(resolve(root, 'home_economy.xls'))).buffer as ArrayBuffer],
    ];

    for (const [name, bytes] of files) {
      const workbook = await readWorkbook(bytes, name);
      for (const sheet of workbook.sheets) {
        for (let index = 0; index < sheet.rows.length; index += 1) {
          expect(Array.isArray(sheet.rows[index]), `${name} sheet "${sheet.name}" row ${index} is a hole`).toBe(true);
        }
      }
    }
  });

  it('labels every cell with a type its value actually matches', async () => {
    const workbook = await readWorkbook(xlsxWorkbook([
      [{ value: 'תאריך', shared: true }, { value: 'סכום' }],
      [{ value: 46237, date: true }, { value: 431 }],
    ]), 'types.xlsx');

    const expectations: Record<string, (value: unknown) => boolean> = {
      s: (value) => typeof value === 'string',
      n: (value) => typeof value === 'number',
      d: (value) => value instanceof Date,
      b: (value) => typeof value === 'boolean',
    };
    for (const sheet of workbook.sheets) {
      for (const row of sheet.rows) {
        for (const cell of row) {
          if (!cell) continue;
          expect(expectations[cell.t], `unknown cell type ${cell.t}`).toBeDefined();
          expect(expectations[cell.t]!(cell.v), `cell typed ${cell.t} holds ${typeof cell.v}`).toBe(true);
        }
      }
    }
  });

  /* The id is what stops a re-imported statement from doubling every figure, so it has
     to be stable across imports and distinct between rows. */
  it('derives an id that is stable across imports and distinct per transaction', () => {
    const workbook: Workbook = { sheets: [{ name: 'card', rows: [
      [{ t: 's', v: 'תאריך' }, { t: 's', v: 'בית עסק' }, { t: 's', v: 'סכום עסקה' }],
      [{ t: 's', v: '15/08/2026' }, { t: 's', v: 'ספק' }, { t: 'n', v: 99 }],
      [{ t: 's', v: '15/08/2026' }, { t: 's', v: 'ספק' }, { t: 'n', v: 120 }],
    ] }] };

    const first = creditCardImporter.import(workbook, 'monthly.xls');
    const second = creditCardImporter.import(workbook, 'monthly.xls');

    expect(first.map((row) => row.id)).toEqual(second.map((row) => row.id));
    expect(new Set(first.map((row) => row.id)).size).toBe(first.length);
  });

  /* A message key that reaches the customer as its own name is a broken screen, and the
     import failures are the ones nobody sees until a file fails. */
  it('resolves every message the import flow asks for', () => {
    const source = readFileSync(resolve(root, 'src/app.ts'), 'utf8');
    const resources = JSON.parse(readFileSync(resolve(root, 'resources/he.json'), 'utf8')) as Record<string, unknown>;
    const requested = [...source.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)].map((match) => match[1]!);

    expect(requested).toContain('fileColumnsUnrecognized');
    expect([...new Set(requested)].filter((key) => !(key in resources))).toEqual([]);
  });
});
