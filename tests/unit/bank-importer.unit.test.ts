import { describe, expect, it } from 'vitest';
import { BankImportStrategy } from '../../src/bank-importer';
import type { Workbook } from '../../src/credit-card-importer';

describe('bank import strategy', () => {
  it('extracts the account only for the active session and returns typed transactions', () => {
    const workbook: Workbook = { sheets: [{ name: 'אוגוסט', rows: [
      [{ t: 's', v: 'חשבון' }, { t: 's', v: '04-279-661711' }],
      [{ t: 's', v: 'תאריך' }, { t: 's', v: 'תיאור פעולה' }, { t: 's', v: 'חובה' }, { t: 's', v: 'יתרה' }],
      [{ t: 's', v: '09/08/2026' }, { t: 's', v: 'מזונות' }, { t: 'n', v: 3000 }, { t: 'n', v: -11203.64 }],
    ] }] };

    const result = new BankImportStrategy().import(workbook, 'private-account.xlsx');

    expect(result.account).toBe('04-279-661711');
    expect(result.rows[0]).toMatchObject({ date: '2026-08-09', desc: 'מזונות', out: 3000, source: 'bank' });
    expect(result.rows[0].id).toEqual(expect.any(String));
  });

  /* A statement downloaded from the bank's English interface carries English headings.
     Matching only the Hebrew ones rejected the whole file. */
  it('reads a statement exported with English column names', () => {
    const workbook: Workbook = { sheets: [{ name: 'August', rows: [
      [{ t: 's', v: 'Date' }, { t: 's', v: 'Description' }, { t: 's', v: 'Debit' }, { t: 's', v: 'Credit' }, { t: 's', v: 'Balance' }],
      [{ t: 's', v: '09/08/2026' }, { t: 's', v: 'SUPERMARKET' }, { t: 'n', v: 431 }, null, { t: 'n', v: 5000 }],
      [{ t: 's', v: '10/08/2026' }, { t: 's', v: 'SALARY' }, null, { t: 'n', v: 17400 }, { t: 'n', v: 22400 }],
    ] }] };

    const result = new BankImportStrategy().import(workbook, 'statement.xlsx');

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ desc: 'SUPERMARKET', out: 431, in: 0, bal: 5000 });
    expect(result.rows[1]).toMatchObject({ desc: 'SALARY', out: 0, in: 17400 });
  });

  /* The card path shares this reader as a fallback, and there a single signed column is
     a charge when positive and a refund when negative — the opposite of a statement,
     where a negative amount is money going out. */
  it('splits a single signed column by sign when the source is a card', () => {
    const workbook: Workbook = { sheets: [{ name: 'card', rows: [
      [{ t: 's', v: 'תאריך עסקה' }, { t: 's', v: 'שם בית עסק' }, { t: 's', v: 'סכום חיוב' }],
      [{ t: 's', v: '03/08/2026' }, { t: 's', v: 'שופרסל' }, { t: 'n', v: 431 }],
      [{ t: 's', v: '04/08/2026' }, { t: 's', v: 'החזר' }, { t: 'n', v: -60 }],
    ] }] };

    const result = new BankImportStrategy().import(workbook, 'card.xls', 'card');

    expect(result.rows[0]).toMatchObject({ out: 431, in: 0, source: 'card' });
    expect(result.rows[1]).toMatchObject({ out: 0, in: 60 });
  });
});
