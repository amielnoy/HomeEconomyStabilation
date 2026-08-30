/* Builders for the container formats an issuer or a bank actually hands out. The .xlsx
   path in particular had no coverage at all: every existing test either hand-writes a
   parsed workbook or reads the one legacy .xls fixture, so nothing exercised the zip
   reader, the shared-string table or the style-driven date detection. Writing the bytes
   here keeps that reachable without checking binaries into the repository. */

import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip the reader has to unpack. Stored entries keep a fixture readable; deflated ones
    are what a real .xlsx always contains, and are the only way to exercise the inflate
    path the application depends on. */
export function storedZip(entries: Record<string, string>, deflate = false): ArrayBuffer {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const raw = encoder.encode(text);
    const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const crc = crc32(raw);
    const method = deflate ? 8 : 0;

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, raw.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, raw.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, centrals.length, true);
  endView.setUint16(10, centrals.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, cursor); cursor += part.length; }
  return out.buffer;
}

export interface XlsxCell {
  readonly value: string | number;
  /** Written as a shared string rather than inline, so the SST path is exercised too. */
  readonly shared?: boolean;
  /** Applies the date-formatted style, which is how a real export carries a date. */
  readonly date?: boolean;
}

export interface XlsxOptions {
  readonly sheetName?: string;
  /** Some writers omit the optional r="A1" references entirely. */
  readonly omitReferences?: boolean;
  /** Compress the entries, as every real .xlsx does. */
  readonly deflate?: boolean;
  /** Leave this many rows unwritten above the first, as a real export's blank lines do. */
  readonly startRow?: number;
}

const COLUMN_NAME = (index: number): string => {
  let name = '';
  let value = index;
  do { name = String.fromCharCode(65 + (value % 26)) + name; value = Math.floor(value / 26) - 1; } while (value >= 0);
  return name;
};

const escapeXml = (text: string): string => text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A minimal but genuine .xlsx: content types, workbook, relationships, styles, an
    optional shared-string table and one worksheet. */
export function xlsxWorkbook(rows: ReadonlyArray<ReadonlyArray<XlsxCell | null>>, options: XlsxOptions = {}): ArrayBuffer {
  /* A prefixed document is valid OOXML and several issuers write one; a reader that looks
     tags up by qualified name finds nothing in it. */
  const p = options.prefixed ? 'x:' : '';
  const ns = options.prefixed ? ' xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' : '';
  const shared: string[] = [];
  const sharedIndex = (text: string): number => {
    const existing = shared.indexOf(text);
    if (existing >= 0) return existing;
    shared.push(text);
    return shared.length - 1;
  };

  const offset = options.startRow ?? 0;
  const sheetRows = rows.map((cells, index) => {
    const rowIndex = index + offset;
    const written = cells.map((cell, columnIndex) => {
      if (!cell) return '';
      const reference = options.omitReferences ? '' : ` r="${COLUMN_NAME(columnIndex)}${rowIndex + 1}"`;
      if (typeof cell.value === 'number') {
        return `<${p}c${reference}${cell.date ? ' s="1"' : ''}><${p}v>${cell.value}</${p}v></${p}c>`;
      }
      if (cell.shared) return `<${p}c${reference} t="s"><${p}v>${sharedIndex(cell.value)}</${p}v></${p}c>`;
      return `<${p}c${reference} t="inlineStr"><${p}is><${p}t>${escapeXml(cell.value)}</${p}t></${p}is></${p}c>`;
    }).join('');
    return `<${p}row${options.omitReferences ? '' : ` r="${rowIndex + 1}"`}>${written}</${p}row>`;
  }).join('');

  const sheetXml = '<?xml version="1.0" encoding="UTF-8"?>'
    + (options.prefixed
      ? `<x:worksheet${ns}><x:sheetData>${sheetRows}</x:sheetData></x:worksheet>`
      : '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + `<sheetData>${sheetRows}</sheetData></worksheet>`);

  /* cellXfs index 1 carries a built-in date format, which is the only signal a reader
     has that a number is really a date. */
  const stylesXml = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs>'
    + '</styleSheet>';

  const sharedXml = '<?xml version="1.0" encoding="UTF-8"?>'
    + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">`
    + shared.map((text) => `<si><t>${escapeXml(text)}</t></si>`).join('')
    + '</sst>';

  return storedZip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="xml" ContentType="application/xml"/></Types>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?>'
      + (options.prefixed
        ? `<x:workbook${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
          + `<x:sheets><x:sheet name="${escapeXml(options.sheetName ?? 'Sheet1')}" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`
        : '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets><sheet name="${escapeXml(options.sheetName ?? 'Sheet1')}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"'
      + ' Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/styles.xml': stylesXml,
    'xl/sharedStrings.xml': sharedXml,
    'xl/worksheets/sheet1.xml': sheetXml,
  }, options.deflate ?? false);
}

/** SpreadsheetML 2003 — XML named .xls, which is what several issuers call "Excel". */
export function spreadsheetMl(
  rows: ReadonlyArray<ReadonlyArray<{ value: string; type?: 'String' | 'Number' | 'DateTime'; index?: number; mergeAcross?: number } | null>>,
  options: { sheetName?: string; prefixed?: boolean } = {},
): string {
  const tag = (name: string) => (options.prefixed ? `ss:${name}` : name);
  const body = rows.map((cells) => {
    const written = cells.map((cell) => {
      if (!cell) return '';
      const attributes = [
        cell.index === undefined ? '' : ` ss:Index="${cell.index}"`,
        cell.mergeAcross === undefined ? '' : ` ss:MergeAcross="${cell.mergeAcross}"`,
      ].join('');
      return `<${tag('Cell')}${attributes}><${tag('Data')} ss:Type="${cell.type ?? 'String'}">`
        + escapeXml(cell.value)
        + `</${tag('Data')}></${tag('Cell')}>`;
    }).join('');
    return `<${tag('Row')}>${written}</${tag('Row')}>`;
  }).join('');

  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"'
    + ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'
    + `<Worksheet ss:Name="${escapeXml(options.sheetName ?? 'Sheet1')}"><Table>${body}</Table></Worksheet></Workbook>`;
}

export const toArrayBuffer = (text: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};
