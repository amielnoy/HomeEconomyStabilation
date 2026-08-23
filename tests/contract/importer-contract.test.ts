import { describe, expect, it } from 'vitest';
import { creditCardImporter, type TransactionRecord, type Workbook } from '../../src/credit-card-importer';

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
});
