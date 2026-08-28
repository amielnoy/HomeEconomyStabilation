import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCSV, readWorkbook } from '../../src/spreadsheet-reader';

const buffer = (text: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

const values = (workbook: Awaited<ReturnType<typeof readWorkbook>>, sheet = 0) =>
  (workbook.sheets[sheet]?.rows ?? []).map((row) => [...row].map((cell) => cell?.v ?? null));

describe('spreadsheet reader', () => {
  it('splits on every delimiter an Israeli bank export might use', () => {
    const { sheets } = parseCSV('a,b\nc\td\ne;f');
    expect(sheets[0]!.rows.map((row) => row.map((cell) => cell?.v))).toEqual([
      ['a', 'b'], ['c', 'd'], ['e', 'f'],
    ]);
  });

  it('honours quoted fields, escaped quotes and embedded delimiters', () => {
    const { sheets } = parseCSV('"Smith, John","he said ""hi""",plain');
    expect(sheets[0]!.rows[0]!.map((cell) => cell?.v)).toEqual([
      'Smith, John', 'he said "hi"', 'plain',
    ]);
  });

  it('keeps empty fields as holes rather than empty strings', () => {
    const { sheets } = parseCSV('a,,c');
    const row = sheets[0]!.rows[0]!;
    expect(row[0]?.v).toBe('a');
    expect(row[1]).toBeNull();
    expect(row[2]?.v).toBe('c');
  });

  it('ignores carriage returns so CRLF exports do not gain a stray character', () => {
    const { sheets } = parseCSV('a,b\r\nc,d\r\n');
    expect(sheets[0]!.rows.map((row) => row.map((cell) => cell?.v))).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('names the sheet after the file so the source stays traceable', () => {
    expect(parseCSV('a', 'statement.csv').sheets[0]!.name).toBe('statement.csv');
  });

  it('reads a real legacy .xls workbook end to end', async () => {
    const file = readFileSync(resolve('home_economy.xls'));
    const workbook = await readWorkbook(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
      'home_economy.xls',
    );

    expect(workbook.sheets.length).toBeGreaterThan(0);
    const rows = values(workbook);
    expect(rows.length).toBeGreaterThan(1);
    // A bank export is a grid of strings, numbers and dates — never all one type.
    const kinds = new Set(workbook.sheets[0]!.rows.flat().flatMap((cell) => cell ? [cell.t] : []));
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('dispatches on magic bytes, not on the file extension', async () => {
    // A .csv name over CFB bytes must still be read as the compound file it is.
    const file = readFileSync(resolve('home_economy.xls'));
    const workbook = await readWorkbook(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
      'mislabelled.csv',
    );
    expect(workbook.sheets[0]!.name).not.toBe('mislabelled.csv');
  });

  it('reads an HTML table shipped under an .xls name', async () => {
    const workbook = await readWorkbook(buffer(
      '<html><body><table>'
      + '<tr><th>תאריך</th><th>תיאור פעולה</th><th>חובה</th></tr>'
      + '<tr><td>01/08/2026</td><td>שופרסל דיל</td><td>120.50</td></tr>'
      + '</table></body></html>',
    ), 'statement.xls');
    expect(values(workbook)).toEqual([
      ['תאריך', 'תיאור פעולה', 'חובה'],
      ['01/08/2026', 'שופרסל דיל', '120.50'],
    ]);
  });

  it('keeps columns aligned with the header across colspan and rowspan', async () => {
    const workbook = await readWorkbook(buffer(
      '<table>'
      + '<tr><td rowspan="2">a</td><td>b</td><td>c</td></tr>'
      + '<tr><td colspan="2">d</td></tr>'
      + '<tr><td>e</td><td>f</td><td>g</td></tr>'
      + '</table>',
    ), 'spans.xls');
    expect(values(workbook)).toEqual([
      ['a', 'b', 'c'],
      ['a', 'd', null],
      ['e', 'f', 'g'],
    ]);
  });

  it('reads the statement table rather than the layout table wrapping it', async () => {
    const workbook = await readWorkbook(buffer(
      '<table><tr><td><table><tr><td>תאריך</td><td>סכום</td></tr></table></td></tr></table>',
    ), 'nested.xls');
    expect(workbook.sheets).toHaveLength(1);
    expect(values(workbook)).toEqual([['תאריך', 'סכום']]);
  });

  /* Decoded as UTF-8 these bytes are replacement characters, which match no
     categorisation rule and would quietly land every row in "other". */
  it('honours a declared windows-1255 charset instead of assuming UTF-8', async () => {
    const body = '<html><head><meta charset="windows-1255"></head><body><table><tr><td>'
      + 'שופרסל</td></tr></table></body></html>';
    const bytes = new Uint8Array([...body].map((character) => {
      const code = character.codePointAt(0)!;
      // windows-1255 maps Hebrew U+05D0..U+05EA onto 0xE0..0xFA.
      return code >= 0x05d0 && code <= 0x05ea ? code - 0x05d0 + 0xe0 : code;
    }));
    const workbook = await readWorkbook(bytes.buffer as ArrayBuffer, 'hebrew.xls');
    expect(workbook.sheets[0]!.rows[0]![0]!.v).toBe('שופרסל');
  });

  it('keeps bank-controlled markup inside a cell as text', async () => {
    const workbook = await readWorkbook(buffer(
      '<table><tr><td>&lt;img src=x onerror=alert(1)&gt;</td></tr></table>',
    ), 'xss.xls');
    expect(workbook.sheets[0]!.rows[0]![0]!.v).toBe('<img src=x onerror=alert(1)>');
  });

  it('treats anything else as delimited text rather than failing', async () => {
    const workbook = await readWorkbook(buffer('תאריך,סכום\n01/08/2026,120'), 'plain.csv');
    expect(values(workbook)).toEqual([['תאריך', 'סכום'], ['01/08/2026', '120']]);
  });

  /* An issuer's "Excel" download is often SpreadsheetML 2003: XML named .xls. Its
     <Table> made the HTML reader claim the file, which then found no <tr> and returned
     an empty sheet, so a perfectly good card report imported as nothing. */
  it('reads a SpreadsheetML 2003 workbook named .xls', async () => {
    const workbook = await readWorkbook(buffer(
      '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"'
      + ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="עסקאות"><Table>'
      + '<Row><Cell><Data ss:Type="String">תאריך עסקה</Data></Cell>'
      + '<Cell><Data ss:Type="String">שם בית העסק</Data></Cell>'
      + '<Cell><Data ss:Type="String">סכום חיוב</Data></Cell></Row>'
      + '<Row><Cell><Data ss:Type="String">03/08/2026</Data></Cell>'
      + '<Cell><Data ss:Type="String">שופרסל</Data></Cell>'
      + '<Cell><Data ss:Type="Number">431</Data></Cell></Row>'
      + '</Table></Worksheet></Workbook>',
    ), 'card.xls');

    expect(workbook.sheets[0]!.name).toBe('עסקאות');
    expect(values(workbook)).toEqual([
      ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב'],
      ['03/08/2026', 'שופרסל', 431],
    ]);
  });

  /* ss:Index is how the format writes a gap. Ignoring it slid every later value one
     column left, under the wrong heading. */
  it('keeps SpreadsheetML columns aligned across a skipped index', async () => {
    const workbook = await readWorkbook(buffer(
      '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"'
      + ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="s"><Table>'
      + '<Row><Cell><Data ss:Type="String">א</Data></Cell>'
      + '<Cell ss:Index="3"><Data ss:Type="String">ג</Data></Cell></Row>'
      + '</Table></Worksheet></Workbook>',
    ), 'gaps.xls');

    expect(values(workbook)).toEqual([['א', null, 'ג']]);
  });

  it('rejects a compound file whose signature does not match', async () => {
    const bytes = new Uint8Array(600);
    bytes[0] = 0xd0; bytes[1] = 0xcf;
    await expect(readWorkbook(bytes.buffer as ArrayBuffer, 'broken.xls')).rejects.toThrow();
  });
});
