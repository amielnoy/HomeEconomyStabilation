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

  /* Max writes every column with the definite article. Nothing matched, the file was
     reported unreadable, and the customer had no card data at all. */
  it('reads an issuer that writes its headers with the definite article', () => {
    const result = strategy.import(workbook([
      [cell('תאריך העסקה'), cell('שם בית העסק'), cell('סכום העסקה'), cell('סכום החיוב')],
      [cell('01/08/2026'), cell('שופרסל דיל'), cell(125.5), cell(125.5)],
    ]), 'max.xlsx');

    expect(result[0]).toMatchObject({ date: '2026-08-01', desc: 'שופרסל דיל', out: 125.5, in: 0 });
  });

  /* A foreign purchase is billed in shekels; the transaction column holds the merchant's
     currency, so charging the customer 40 dollars as 40 shekels understates the month. */
  it('bills the charged amount rather than the foreign transaction amount', () => {
    const result = strategy.import(workbook([
      [cell('תאריך עסקה'), cell('שם בית עסק'), cell('סכום עסקה'), cell('סכום חיוב')],
      [cell('04/08/2026'), cell('AMAZON'), cell(40), cell(148.2)],
    ]), 'card.xls');

    expect(result[0]).toMatchObject({ out: 148.2, in: 0 });
  });

  /* With a credit column present every charge was read out of the empty credit cell and
     dropped, so a statement carrying one refund imported as no transactions at all. */
  it('keeps charges when the statement has a separate credit column', () => {
    const result = strategy.import(workbook([
      [cell('תאריך עסקה'), cell('שם בית עסק'), cell('חיוב'), cell('זיכוי')],
      [cell('05/08/2026'), cell('סופר'), cell(125.5), cell('')],
      [cell('06/08/2026'), cell('החזר רכישה'), cell(''), cell(20)],
    ]), 'card.xls');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ out: 125.5, in: 0 });
    expect(result[1]).toMatchObject({ out: 0, in: 20 });
  });

  it('reads a bracketed amount as a refund', () => {
    const result = strategy.import(workbook([
      [cell('תאריך עסקה'), cell('שם בית עסק'), cell('סכום עסקה')],
      [cell('07/08/2026'), cell('החזר'), cell('(20.00)')],
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
