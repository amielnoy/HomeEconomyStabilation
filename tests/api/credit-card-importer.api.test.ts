import { describe, expect, it } from 'vitest';
import { creditCardImporter, describeColumns, type Workbook } from '../../src/credit-card-importer';

const workbook: Workbook = {
  sheets: [{
    name: 'אוגוסט 2026',
    rows: [
      [{ t: 's', v: 'תאריך עסקה' }, { t: 's', v: 'שם בית עסק' }, { t: 's', v: 'סכום לחיוב' }],
      [{ t: 's', v: '10/08/2026' }, { t: 's', v: 'תחבורה' }, { t: 'n', v: 42 }],
    ],
  }],
};

describe('credit-card-importer API contract', () => {
  it('returns stable transaction records through the public import API', () => {
    const response = creditCardImporter.import(workbook, 'august-card.xls');

    expect(response).toHaveLength(1);
    expect(response[0]).toEqual(expect.objectContaining({
      date: '2026-08-10',
      desc: 'תחבורה',
      out: 42,
      in: 0,
      source: 'card',
      src: 'august-card.xls',
    }));
    expect(response[0].id).toEqual(expect.any(String));
  });

  /* A rejected file used to reach the customer as a count with no detail. The columns
     the reader did find are the one piece of evidence that identifies the layout. */
  it('reports the heading row it found so an unsupported layout can be identified', () => {
    const unknown: Workbook = { sheets: [{ name: 'sheet', rows: [
      [{ t: 's', v: 'כרטיס' }, { t: 's', v: '1234' }],
      [{ t: 's', v: 'עמודה א' }, { t: 's', v: 'עמודה ב' }, { t: 's', v: 'עמודה ג' }],
      [{ t: 's', v: '1' }, { t: 's', v: '2' }, { t: 's', v: '3' }],
    ] }] };

    expect(describeColumns(unknown)).toBe('עמודה א · עמודה ב · עמודה ג');
  });

  it('describes nothing when the workbook carries no text at all', () => {
    expect(describeColumns({ sheets: [{ name: 'empty', rows: [[{ t: 'n', v: 1 }]] }] })).toBe('');
  });

  it('leaves the caller\'s workbook untouched while importing', () => {
    const snapshot = JSON.stringify(workbook);

    creditCardImporter.import(workbook, 'august-card.xls');

    expect(JSON.stringify(workbook)).toBe(snapshot);
  });

  it('rejects unsupported workbook contracts', () => {
    expect(() => creditCardImporter.import({ sheets: [{ name: 'empty', rows: [] }] }, 'empty.xls'))
      .toThrow('לא זוהה מבנה של דוח כרטיס אשראי');
  });
});
