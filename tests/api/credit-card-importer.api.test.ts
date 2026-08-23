import { describe, expect, it } from 'vitest';
import { creditCardImporter, type Workbook } from '../../src/credit-card-importer';

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

  it('rejects unsupported workbook contracts', () => {
    expect(() => creditCardImporter.import({ sheets: [{ name: 'empty', rows: [] }] }, 'empty.xls'))
      .toThrow('לא זוהה מבנה של דוח כרטיס אשראי');
  });
});
