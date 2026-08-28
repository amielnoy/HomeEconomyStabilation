import { describe, expect, it } from 'vitest';
import { creditCardImporter, describeColumns } from '../../src/credit-card-importer';
import { readWorkbook } from '../../src/spreadsheet-reader';
import { spreadsheetMl, toArrayBuffer, xlsxWorkbook } from '../helpers/workbook-fixtures';

/* An imported report is attacker-influenced input: the customer downloads it from a site,
   or is sent one and told it is their statement. The reader parses it with DOMParser and
   the importer copies its text into the page, so both are on the trust boundary even
   though nothing here ever reaches a server. */

describe('import safety', () => {
  /* An external entity in a file the customer was sent would turn "load my statement"
     into a read of whatever the parser can reach. */
  it('does not resolve external entities declared by a SpreadsheetML file', async () => {
    const hostile = '<?xml version="1.0"?>'
      + '<!DOCTYPE Workbook [<!ENTITY leak SYSTEM "file:///etc/passwd">]>'
      + '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"'
      + ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="s"><Table>'
      + '<Row><Cell><Data ss:Type="String">&leak;</Data></Cell></Row>'
      + '</Table></Worksheet></Workbook>';

    const workbook = await readWorkbook(toArrayBuffer(hostile), 'hostile.xls');

    const text = JSON.stringify(workbook);
    expect(text).not.toContain('root:');
    expect(text).not.toContain('/bin/');
  });

  /* A sheet or a heading named __proto__ must stay a string. If it ever reached an
     object key, one downloaded file could change the behaviour of every later object. */
  it('keeps a __proto__ sheet name and heading out of the object prototype', async () => {
    const workbook = await readWorkbook(toArrayBuffer(spreadsheetMl([
      [{ value: '__proto__' }, { value: 'constructor' }, { value: 'polluted' }],
      [{ value: '03/08/2026' }, { value: 'x' }, { value: '1' }],
    ], { sheetName: '__proto__' })), 'proto.xls');

    expect(workbook.sheets[0]!.name).toBe('__proto__');
    describeColumns(workbook);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  /* Markup in a cell is the report's content, never the page's. */
  it('keeps markup inside a SpreadsheetML cell as text rather than nodes', async () => {
    const workbook = await readWorkbook(toArrayBuffer(spreadsheetMl([
      [{ value: '<img src=x onerror=alert(1)>' }],
    ])), 'xss.xls');

    expect(workbook.sheets[0]!.rows[0]![0]!.v).toBe('<img src=x onerror=alert(1)>');
  });

  /* A colspan is a 16-bit number in a file the customer did not write. Honouring a
     hostile one would allocate a row wide enough to hang the tab on a phone. */
  it('clamps an oversized colspan instead of allocating the row it asks for', async () => {
    const workbook = await readWorkbook(toArrayBuffer(
      '<table><tr><td colspan="65535">א</td><td>ב</td></tr></table>',
    ), 'wide.xls');

    expect(workbook.sheets[0]!.rows[0]!.length).toBeLessThanOrEqual(128);
  });

  /* The reader must fail files it cannot understand rather than hand back something
     that looks like transactions the customer never made. */
  it('refuses a truncated .xlsx rather than inventing a workbook', async () => {
    const complete = new Uint8Array(xlsxWorkbook([[{ value: 'תאריך' }]]));
    const truncated = complete.slice(0, Math.floor(complete.length / 2));

    await expect(readWorkbook(truncated.buffer as ArrayBuffer, 'truncated.xlsx')).rejects.toThrow();
  });

  /* The importer is the last thing between a downloaded file and the customer's money
     figures: a row it cannot read has to be dropped, never guessed at. */
  it('drops rows whose amount is not a number instead of importing a zero', async () => {
    const workbook = await readWorkbook(toArrayBuffer(
      'תאריך עסקה,שם בית עסק,סכום חיוב\n03/08/2026,שופרסל,לא-מספר\n04/08/2026,נטפליקס,54.90',
    ), 'mixed.csv');

    const rows = creditCardImporter.import(workbook, 'mixed.csv');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ desc: 'נטפליקס', out: 54.9 });
  });

  /* Nothing in the import path may reach the network: the promise the product makes is
     that a statement never leaves the device. */
  it('imports a report without any network call', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((input: unknown) => {
      calls.push(String(input));
      return Promise.reject(new Error('network blocked'));
    }) as typeof globalThis.fetch;

    try {
      const workbook = await readWorkbook(toArrayBuffer(
        'תאריך עסקה,שם בית עסק,סכום חיוב\n03/08/2026,שופרסל,431',
      ), 'card.csv');
      creditCardImporter.import(workbook, 'card.csv');
    } finally {
      globalThis.fetch = original;
    }

    expect(calls).toEqual([]);
  });
});
