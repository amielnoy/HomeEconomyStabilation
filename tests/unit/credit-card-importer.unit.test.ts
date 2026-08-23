import { describe, expect, it } from 'vitest';
import { CreditCardImportStrategy, type Workbook } from '../../src/credit-card-importer';

const cell = (value: string | number) => ({ t: typeof value === 'number' ? 'n' : 's', v: value });
const workbook = (rows: Workbook['sheets'][number]['rows']): Workbook => ({ sheets: [{ name: 'כרטיס', rows }] });

describe('CreditCardImportStrategy', () => {
  const strategy = new CreditCardImportStrategy();

  it('converts positive charges into expenses', () => {
    const result = strategy.import(workbook([
      [cell('תאריך עסקה'), cell('שם בית עסק'), cell('סכום עסקה')],
      [cell('01/08/2026'), cell('סופר'), cell(125.5)],
    ]), 'card.csv');

    expect(result[0]).toMatchObject({ date: '2026-08-01', desc: 'סופר', out: 125.5, in: 0, source: 'card' });
  });

  it('converts negative signed card amounts into refunds', () => {
    const result = strategy.import(workbook([
      [cell('תאריך עסקה'), cell('שם בית עסק'), cell('סכום עסקה')],
      [cell('02/08/2026'), cell('החזר'), cell(-20)],
    ]), 'card.csv');

    expect(result[0]).toMatchObject({ out: 0, in: 20 });
  });

  it('ignores rows without a valid date or amount', () => {
    const result = strategy.import(workbook([
      [cell('תאריך עסקה'), cell('שם בית עסק'), cell('סכום עסקה')],
      [cell('לא תאריך'), cell('סופר'), cell(20)],
      [cell('03/08/2026'), cell('שורה ריקה'), cell(0)],
    ]), 'card.csv');

    expect(result).toHaveLength(0);
  });
});
