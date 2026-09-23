import { describe, expect, it } from 'vitest';
import { BankImportStrategy, readsAsCardReport } from '../../src/bank-importer';
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
    const row = (desc: string) => result.rows.find((candidate) => candidate.desc === desc);

    expect(result.rows).toHaveLength(2);
    /* By description, not by position: what this covers is the English headings being
       read, and the importer hands a statement back newest-first whatever order the
       file used. */
    expect(row('SUPERMARKET')).toMatchObject({ out: 431, in: 0, bal: 5000 });
    expect(row('SALARY')).toMatchObject({ out: 0, in: 17400 });
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

/* A household loads the file it has through whichever control it happened to click, and
   a card report read as a statement turns a month of spending into a month of income:
   its one amount column means money arriving on the statement path. What the file is
   therefore has to be read from the file. */
describe('recognising a card report by its columns', () => {
  const sheet = (rows: Array<Array<{ t: 's' | 'n'; v: string | number } | null>>): Workbook =>
    ({ sheets: [{ name: 'Sheet1', rows }] });
  const header = (...labels: string[]) => labels.map((v) => ({ t: 's' as const, v }));

  it('reads a merchant list with a single amount column as a card report', () => {
    expect(readsAsCardReport(sheet([
      header('תאריך העסקה', 'שם בית העסק', 'סכום'),
      [{ t: 's', v: '03/09/2026' }, { t: 's', v: 'פלאפל הקריה' }, { t: 'n', v: 33 }],
    ]))).toBe(true);
  });

  /* A running balance means an account, whatever the other columns are called. */
  it('leaves a statement carrying a balance to the statement reader', () => {
    expect(readsAsCardReport(sheet([
      header('תאריך', 'תיאור פעולה', 'סכום', 'יתרה'),
      [{ t: 's', v: '03/09/2026' }, { t: 's', v: 'משכורת' }, { t: 'n', v: 29000 }, { t: 'n', v: 24000 }],
    ]))).toBe(false);
  });

  it('leaves a statement with a debit and a credit column to the statement reader', () => {
    expect(readsAsCardReport(sheet([
      header('תאריך', 'תיאור פעולה', 'חובה', 'זכות'),
      [{ t: 's', v: '03/09/2026' }, { t: 's', v: 'שופרסל דיל' }, { t: 'n', v: 400 }, null],
    ]))).toBe(false);
  });

  /* A statement's own description column says nothing about a business, and a file with
     no recognisable heading at all is not evidence of anything. */
  it('does not reclassify a statement whose description column is its own', () => {
    expect(readsAsCardReport(sheet([
      header('תאריך', 'פרטים', 'סכום'),
      [{ t: 's', v: '03/09/2026' }, { t: 's', v: 'העברה' }, { t: 'n', v: 500 }],
    ]))).toBe(false);
    expect(readsAsCardReport(sheet([[{ t: 's', v: 'עמודה א' }, { t: 's', v: 'עמודה ב' }]]))).toBe(false);
  });

  it('files the same charge as spending once the file is read as a card report', () => {
    const workbook = sheet([
      header('תאריך העסקה', 'שם בית העסק', 'סכום'),
      [{ t: 's', v: '03/09/2026' }, { t: 's', v: 'פלאפל הקריה' }, { t: 'n', v: 33 }],
    ]);

    expect(new BankImportStrategy().import(workbook, 'f.csv', 'bank').rows[0]).toMatchObject({ out: 0, in: 33 });
    expect(new BankImportStrategy().import(workbook, 'f.csv', 'card').rows[0]).toMatchObject({ out: 33, in: 0 });
  });
});

/* A statement in the layout Israeli banks export: the column naming what happened is
   `הפעולה`, and the `פרטים` column beside it is empty on most rows. Reading `פרטים` left
   those rows with no description at all — nothing for a rule to read, and "אחר" against a
   charge the household would have recognised on sight. Structure only: no account holder,
   no counterparty, synthetic numbers. */
describe('a statement that names its operation column הפעולה', () => {
  const workbook: Workbook = { sheets: [{ name: 'גיליון1', rows: [
    [{ t: 's', v: 'תנועות בחשבון' }],
    [{ t: 's', v: 'תאריך' }, { t: 's', v: 'הפעולה' }, { t: 's', v: 'אסמכתא' }, { t: 's', v: 'פרטים' },
     { t: 's', v: 'חובה' }, { t: 's', v: 'זכות' }, { t: 's', v: 'יתרה בש"ח' }, { t: 's', v: 'תאריך ערך' }],
    [{ t: 's', v: '15/09/2026' }, { t: 's', v: 'הו"ק הלו\' בית' }, { t: 'n', v: 626 }, null,
     { t: 'n', v: 565.13 }, null, { t: 'n', v: -25026.99 }, { t: 's', v: '15/09/2026' }],
    [{ t: 's', v: '10/09/2026' }, { t: 's', v: 'משיכה מבנקט' }, { t: 'n', v: 8677 }, null,
     { t: 'n', v: 300 }, null, { t: 'n', v: -25326.99 }, { t: 's', v: '10/09/2026' }],
    [{ t: 's', v: '02/09/2026' }, { t: 's', v: 'העברה מהבנק' }, { t: 'n', v: 10022 }, null,
     null, { t: 'n', v: 29000 }, { t: 'n', v: 3673.01 }, { t: 's', v: '02/09/2026' }],
  ] }] };

  it('reads the operation as the description rather than leaving the row blank', () => {
    const rows = new BankImportStrategy().import(workbook, 'statement.xlsx').rows;

    expect(rows.map((row) => row.desc)).toEqual(['הו"ק הלו\' בית', 'משיכה מבנקט', 'העברה מהבנק']);
  });

  /* The two money columns are where they always were, and the balance is the account's. */
  it('keeps debit, credit and the running balance where the statement put them', () => {
    const rows = new BankImportStrategy().import(workbook, 'statement.xlsx').rows;

    expect(rows[0]).toMatchObject({ out: 565.13, in: 0, bal: -25026.99, date: '2026-09-15' });
    expect(rows[2]).toMatchObject({ out: 0, in: 29000, bal: 3673.01 });
  });

  /* A description the rules can read is the whole point: without it every one of these
     rows fell to "other". */
  it('gives the categorizer something to read', () => {
    const rows = new BankImportStrategy().import(workbook, 'statement.xlsx').rows;

    expect(rows.every((row) => row.desc.length > 0)).toBe(true);
  });
});

/* Which end of the file holds the newest row is the bank's choice, and nothing in a row
   says which choice it made. The display layer reads a day's closing balance off the first
   row it sees for that date, so a statement that arrived oldest-first handed it the balance
   the day opened on — a current balance short by the rest of that day's movements. Settling
   the direction here, once, is what keeps that assumption true for every file. Structure
   only: synthetic amounts, no account holder. */
describe('the order a statement arrives in', () => {
  const HEADER = [{ t: 's' as const, v: 'תאריך' }, { t: 's' as const, v: 'תיאור פעולה' },
    { t: 's' as const, v: 'חובה' }, { t: 's' as const, v: 'יתרה' }];
  const row = (date: string, desc: string, out: number, bal: number) =>
    [{ t: 's' as const, v: date }, { t: 's' as const, v: desc }, { t: 'n' as const, v: out }, { t: 'n' as const, v: bal }];

  /* One account, one week, two movements on the closing day. Oldest-first. */
  const oldestFirst = [
    row('13/08/2026', 'משיכה מבנקט', 100, 1676.02),
    row('16/08/2026', 'משיכה מבנקט', 200, 1476.02),
    row('18/08/2026', 'משיכת מזומן', 40.42, 1435.60),
    row('19/08/2026', 'ישראכרט', 12, 1423.60),
    row('19/08/2026', 'משיכה מבנקט', 100, 1323.60),
  ];
  const statement = (rows: typeof oldestFirst): Workbook =>
    ({ sheets: [{ name: 'תנועות עו"ש', rows: [HEADER, ...rows] }] });

  it('hands back the closing balance of the newest day when the file is oldest-first', () => {
    const rows = new BankImportStrategy().import(statement(oldestFirst), 'statement.xls').rows;

    expect(rows[0]).toMatchObject({ date: '2026-08-19', bal: 1323.60 });
  });

  it('hands back the closing balance of the newest day when the file is newest-first', () => {
    const rows = new BankImportStrategy().import(statement([...oldestFirst].reverse()), 'statement.xls').rows;

    expect(rows[0]).toMatchObject({ date: '2026-08-19', bal: 1323.60 });
  });
});
