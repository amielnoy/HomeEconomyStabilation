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

  /* Issuer exports open with the card number, the billing period and a blank line or
     two before the table starts, so the heading is never the first row. */
  it('finds the heading below the issuer metadata rows', () => {
    const result = strategy.import(workbook([
      [cell('כרטיס אשראי מספר'), cell('1234')],
      [cell('תקופת חיוב'), cell('אוגוסט 2026')],
      [],
      [cell('תאריך עסקה'), cell('שם בית עסק'), cell('סכום חיוב')],
      [cell('03/08/2026'), cell('שופרסל'), cell(431)],
    ]), 'card.xls');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ date: '2026-08-03', out: 431 });
  });

  /* An issuer puts each card on its own sheet; reading only the first lost every
     charge made on the second card. */
  it('imports every sheet when the issuer splits cards across sheets', () => {
    const result = strategy.import({
      sheets: [
        { name: 'כרטיס 1234', rows: [
          [cell('תאריך עסקה'), cell('שם בית עסק'), cell('סכום חיוב')],
          [cell('03/08/2026'), cell('שופרסל'), cell(431)],
        ] },
        { name: 'כרטיס 5678', rows: [
          [cell('תאריך עסקה'), cell('שם בית עסק'), cell('סכום חיוב')],
          [cell('05/08/2026'), cell('נטפליקס'), cell(54.9)],
        ] },
      ],
    }, 'card.xls');

    expect(result.map((row) => row.desc)).toEqual(['שופרסל', 'נטפליקס']);
  });

  it('marks charges on a pending sheet as not yet settled', () => {
    const result = strategy.import({
      sheets: [{ name: 'עסקאות בהמתנה', rows: [
        [cell('תאריך עסקה'), cell('שם בית עסק'), cell('סכום חיוב')],
        [cell('03/08/2026'), cell('דלק'), cell(220)],
      ] }],
    }, 'card.xls');

    expect(result[0]!.pending).toBe(true);
  });

  it('reads an amount written with a currency sign and thousands separators', () => {
    const result = strategy.import(workbook([
      [cell('תאריך עסקה'), cell('שם בית עסק'), cell('סכום חיוב')],
      [cell('03/08/2026'), cell('רהיטים'), cell('₪ 1,250.75')],
    ]), 'card.csv');

    expect(result[0]).toMatchObject({ out: 1250.75, in: 0 });
  });

  /* A spreadsheet date arrives as a Date, not as text, and the reader hands it over
     UTC-anchored so the calendar day cannot drift. */
  it('reads a date-typed cell without shifting the calendar day', () => {
    const result = strategy.import({
      sheets: [{ name: 'card', rows: [
        [cell('תאריך עסקה'), cell('שם בית עסק'), cell('סכום חיוב')],
        [{ t: 'd', v: new Date(Date.UTC(2026, 7, 3)) }, cell('שופרסל'), cell(431)],
      ] }],
    }, 'card.xlsx');

    expect(result[0]!.date).toBe('2026-08-03');
  });

  /* Exports that paginate repeat the heading partway down; it carries no date, so it
     must fall out rather than become a transaction. */
  it('skips a heading repeated in the middle of the data', () => {
    const result = strategy.import(workbook([
      [cell('תאריך עסקה'), cell('שם בית עסק'), cell('סכום חיוב')],
      [cell('03/08/2026'), cell('שופרסל'), cell(431)],
      [cell('תאריך עסקה'), cell('שם בית עסק'), cell('סכום חיוב')],
      [cell('05/08/2026'), cell('נטפליקס'), cell(54.9)],
    ]), 'card.csv');

    expect(result.map((row) => row.desc)).toEqual(['שופרסל', 'נטפליקס']);
  });

  /* An issuer names the due date "חיוב לתאריך", which opens with the same word as the
     charge itself. Read as a money column it took the slot the real amount needed, every
     row then scored its amount out of a date cell, and a statement of 158 rows imported as
     none. A column whose name says when is never a column that says how much. */
  it('does not let a due-date column claim the amount column', () => {
    const result = strategy.import(workbook([
      [cell('שם כרטיס'), cell('חיוב לתאריך'), cell('תאריך'), cell('שם בית עסק'), cell("סכום חיוב בש''ח")],
      [cell('8677'), { t: 'd', v: new Date(Date.UTC(2026, 8, 2)) }, { t: 'd', v: new Date(Date.UTC(2026, 7, 3)) }, cell('סופר'), cell(431)],
    ]), 'card.xlsx');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ date: '2026-08-03', desc: 'סופר', out: 431, in: 0 });
  });

  /* An issuer's sheet is not one table: a summary block, then domestic purchases, then
     foreign ones, each with its own heading and its own columns. Mapping only the first
     heading read the later blocks' rows under the wrong columns, which took a currency for
     a reference and collapsed two distinct charges onto one id — silently dropping one. */
  it('remaps the columns at each block heading in a multi-block sheet', () => {
    const result = strategy.import(workbook([
      [cell('רכישות בארץ')],
      [cell('תאריך'), cell('שם בית עסק'), cell('סכום חיוב'), cell('אסמכתא')],
      [cell('03/08/2026'), cell('סופר'), cell(19.9), cell('151004651922873380')],
      [],
      [cell("רכישות בחו''ל")],
      // The same figures in a block whose columns are ordered differently.
      [cell('תאריך'), cell('אסמכתא'), cell('שם בית עסק'), cell('סכום חיוב')],
      [cell('03/08/2026'), cell('723023360780180008'), cell('סופר'), cell(19.9)],
    ]), 'card.xlsx');

    expect(result).toHaveLength(2);
    expect(result.map((row) => row.ref)).toEqual(['151004651922873380', '723023360780180008']);
    // Distinct references mean distinct ids, so neither charge is taken for a duplicate.
    expect(new Set(result.map((row) => row.id)).size).toBe(2);
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
