import { describe, expect, it } from 'vitest';
import { readWorkbook } from '../../src/spreadsheet-reader';
import { spreadsheetMl, toArrayBuffer, xlsxWorkbook } from '../helpers/workbook-fixtures';

/* readWorkbook is the reader's whole public surface: every caller hands it bytes and a
   file name and expects one shape back, whatever container the bytes turned out to be.
   The unit tests cover each format from the inside; this covers the promise the facade
   makes to the rest of the application. */

describe('spreadsheet reader public API', () => {
  it('accepts every container an issuer or a bank hands out and returns one shape', async () => {
    const files: Array<[string, ArrayBuffer, string]> = [
      ['card.csv', toArrayBuffer('תאריך,סכום\n03/08/2026,431'), 'CSV'],
      ['card.xls', toArrayBuffer('<table><tr><td>תאריך</td></tr></table>'), 'HTML'],
      ['card-ml.xls', toArrayBuffer(spreadsheetMl([[{ value: 'תאריך' }]], { sheetName: 'עסקאות' })), 'SpreadsheetML'],
      ['card.xlsx', xlsxWorkbook([[{ value: 'תאריך' }]], { sheetName: 'עסקאות' }), 'XLSX'],
    ];

    for (const [name, bytes, format] of files) {
      const workbook = await readWorkbook(bytes, name);

      expect(Array.isArray(workbook.sheets), `${format} returned no sheet array`).toBe(true);
      expect(workbook.sheets.length, `${format} returned no sheets`).toBeGreaterThan(0);
      for (const sheet of workbook.sheets) {
        expect(typeof sheet.name, `${format} sheet has no name`).toBe('string');
        expect(Array.isArray(sheet.rows), `${format} sheet has no rows array`).toBe(true);
      }
    }
  });

  /* The extension is what the issuer chose to call the file, not what it is: an .xls that
     is really HTML or XML is the common case rather than the exception. */
  it('dispatches on the content rather than on the file name', async () => {
    const asHtml = await readWorkbook(toArrayBuffer('<table><tr><td>שופרסל</td></tr></table>'), 'statement.xlsx');
    const asMl = await readWorkbook(toArrayBuffer(spreadsheetMl([[{ value: 'שופרסל' }]], { sheetName: 'גיליון' })), 'statement.csv');

    expect(asHtml.sheets[0]!.rows[0]![0]!.v).toBe('שופרסל');
    expect(asMl.sheets[0]!.name).toBe('גיליון');
  });

  /* A caller has to be able to tell "unreadable" from "empty": one is a file the customer
     should re-export, the other is a month with no spending. */
  it('throws for bytes it cannot read rather than returning an empty workbook', async () => {
    const compoundHeader = new Uint8Array(600);
    compoundHeader[0] = 0xd0;
    compoundHeader[1] = 0xcf;

    await expect(readWorkbook(compoundHeader.buffer as ArrayBuffer, 'broken.xls')).rejects.toThrow();
    await expect(readWorkbook(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]).buffer as ArrayBuffer, 'broken.xlsx'))
      .rejects.toThrow();
  });

  it('names an unnamed sheet after the file so the source stays traceable', async () => {
    const workbook = await readWorkbook(toArrayBuffer('תאריך,סכום\n03/08/2026,431'), 'august-card.csv');

    expect(workbook.sheets[0]!.name).toBe('august-card.csv');
  });
});
