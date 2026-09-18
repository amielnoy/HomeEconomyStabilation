import { describe, expect, it } from 'vitest';
import { bankImporter } from '../../src/bank-importer';
import { creditCardImporter, type Workbook } from '../../src/credit-card-importer';
import { legacyCardCorrections } from '../../src/import-corrections';

const cells = (...values: Array<string | number | Date>) => values.map(v => ({ t: typeof v === 'number' ? 'n' : 's', v }));
const domestic = cells('שם כרטיס', 'חיוב לתאריך', 'תאריך', 'שם בית עסק', "סכום חיוב בש''ח", 'סכום קנייה', 'אסמכתא');
const foreign = cells('שם כרטיס', 'חיוב לתאריך', 'תאריך', 'שם בית עסק', "סכום חיוב בש''ח", 'סכום קנייה', 'מטבע מקורי', 'אסמכתא');
const workbook: Workbook = { sheets: [{ name: 'Sheet1', rows: [
  domestic,
  cells('1234', new Date('2026-10-10T00:00:00Z'), '08/09/2026', 'מועדון', 40, 200, 'reference-a'),
  foreign,
  cells('1234', new Date('2026-10-10T00:00:00Z'), '08/09/2026', 'SUBSCRIPTION', 65, 20, 'USD', 'reference-b'),
  cells('1234', new Date('2026-10-10T00:00:00Z'), '08/09/2026', 'REFUND', -65, 20, 'USD', 'reference-c'),
] }] };

describe('reimporting a card report formerly read as a bank statement', () => {
  it('matches installments even when the billed amount differs from the purchase amount', () => {
    const old = bankImporter.import(workbook, 'old.xlsx').rows;
    const current = creditCardImporter.import(workbook, 'new.xlsx');
    expect(old[0]).toMatchObject({ in: 200, out: 0 });
    expect(current[0]).toMatchObject({ in: 0, out: 40 });
    expect(legacyCardCorrections(workbook).get(old[0]!.id!)).toBe(current[0]!.id);
  });

  it('matches foreign purchases when both the amount and reference were read incorrectly', () => {
    const old = bankImporter.import(workbook, 'old.xlsx').rows;
    const current = creditCardImporter.import(workbook, 'new.xlsx');
    expect(old[1]).toMatchObject({ in: 20, ref: 'USD' });
    expect(current[1]).toMatchObject({ out: 65, ref: 'reference-b' });
    expect(legacyCardCorrections(workbook).get(old[1]!.id!)).toBe(current[1]!.id);
  });

  it('removes a purchase waived in full instead of recording its original price', () => {
    const waived: Workbook = { sheets: [{ name: 'Sheet1', rows: [domestic,
      cells('1234', new Date('2026-10-10T00:00:00Z'), '08/09/2026', 'Card fee', '', 22, 'reference-fee'),
    ] }] };
    const old = bankImporter.import(waived, 'old.xlsx').rows[0]!;
    expect(creditCardImporter.import(waived, 'new.xlsx')).toEqual([]);
    expect(legacyCardCorrections(waived).get(old.id!)).toBeNull();
  });

  it('replaces the incorrect purchase amount with the actual credit', () => {
    const current = creditCardImporter.import(workbook, 'new.xlsx');
    expect(current[2]).toMatchObject({ out: 0, in: 65 });
    expect([...legacyCardCorrections(workbook).values()]).toContain(current[2]!.id);
  });
});
