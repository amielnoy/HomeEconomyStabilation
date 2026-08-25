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

  it('refuses an HTML table masquerading as a statement', async () => {
    await expect(readWorkbook(buffer('<html><table><tr><td>1</td></tr></table></html>'), 'x.xls'))
      .rejects.toThrow('HTML_TABLE');
  });

  it('treats anything else as delimited text rather than failing', async () => {
    const workbook = await readWorkbook(buffer('תאריך,סכום\n01/08/2026,120'), 'plain.csv');
    expect(values(workbook)).toEqual([['תאריך', 'סכום'], ['01/08/2026', '120']]);
  });

  it('rejects a compound file whose signature does not match', async () => {
    const bytes = new Uint8Array(600);
    bytes[0] = 0xd0; bytes[1] = 0xcf;
    await expect(readWorkbook(bytes.buffer as ArrayBuffer, 'broken.xls')).rejects.toThrow();
  });
});
