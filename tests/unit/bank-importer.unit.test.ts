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
});
