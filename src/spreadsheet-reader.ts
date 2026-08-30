/* Reader for the spreadsheet formats Israeli banks actually export: legacy .xls
   (BIFF8 inside a CFB container), .xlsx (ZIP + SpreadsheetML) and .csv. Returns
   { sheets: [ { name, rows: [ [cell,…] ] } ] } where each cell is
   { v: value, t: 's'|'n'|'d'|'b'|'e' }. Dependency-free, and the only platform
   APIs it touches are TextDecoder, DOMParser and DecompressionStream, so it runs
   unchanged in Node 18+ and in the browser. */

import type { Workbook, SpreadsheetCell } from './credit-card-importer.js';

/** Byte at `i`, treating a read past the end as a zero pad rather than undefined.
    Every caller has already bounds-checked its record; this keeps that guarantee
    visible instead of scattered through non-null assertions. */
const at = (b: Uint8Array, i: number): number => b[i] ?? 0;

const SE = (b: Uint8Array | ArrayBuffer): DataView => b instanceof ArrayBuffer
  ? new DataView(b)
  : new DataView(b.buffer, b.byteOffset, b.byteLength);

/* ---------------------------------------------------------------- utilities */

function utf16le(bytes: Uint8Array, start: number, len: number): string {
  return new TextDecoder('utf-16le').decode(bytes.subarray(start, start + len * 2));
}
function latin1(bytes: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(at(bytes, start + i));
  return s;
}

/* Both spreadsheet readers address rows by index, so every row the file never mentions —
   the blank lines above a statement's heading, most often — is left as a hole rather than
   an empty row. The importers walk rows and index into them, so one hole is a TypeError
   that surfaces to the customer as "the file could not be read". Filling them here keeps
   that promise in the one place every reader already passes through. */
function densify(rows: Array<Array<SpreadsheetCell | null>>): Array<Array<SpreadsheetCell | null>> {
  for (let index = 0; index < rows.length; index += 1) rows[index] ??= [];
  return rows;
}

/* Excel serial date -> Date (UTC-anchored, so the calendar day never drifts). */
function serialToDate(serial: number, date1904: boolean): Date {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const days = Math.floor(serial);
  const frac = serial - days;
  /* The 1900 system pretends 1900 was a leap year, which shifts every serial past
     60 by a day. Anchoring the epoch at 1899-12-30 rather than 1900-01-01 absorbs
     that shift, so no further correction belongs here. */
  const ms = epoch + days * 86400000 + Math.round(frac * 86400000);
  return new Date(ms);
}

const BUILTIN_DATE_FMT = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47,
  50, 51, 52, 53, 54, 55, 56, 57, 58,
  71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81,
]);

/* Does a number-format string describe a date/time? Strips quoted literals,
   escapes, colour/condition brackets and the currency-locale bracket first, so
   that e.g. [$₪-40D]#,##0.00 is not mistaken for a date because of the "D". */
function fmtIsDate(fmt: string | undefined | null): boolean {
  if (!fmt) return false;
  const stripped = fmt
    .replace(/\\./g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '');
  return /[ymdhs]/i.test(stripped) && !/^[^ymdhs]*$/i.test(stripped);
}

/* --------------------------------------------------------------------- CFB */

function readCFB(buf: ArrayBuffer): { entries: Array<{ name: string; type: number; start: number; size: number }>; readStream: (entry: { start: number; size: number }) => Uint8Array } {
  const b = new Uint8Array(buf);
  const dv = SE(b);
  const sig = dv.getUint32(0, true) === 0xe011cfd0 && dv.getUint32(4, true) === 0xe11ab1a1;
  if (!sig) throw new Error('not a compound file');

  const sectorShift = dv.getUint16(30, true);
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << dv.getUint16(32, true);
  const numFAT = dv.getUint32(44, true);
  const dirStart = dv.getUint32(48, true);
  const miniCutoff = dv.getUint32(56, true);
  const miniFATStart = dv.getUint32(60, true);
  const numMiniFAT = dv.getUint32(64, true);
  const difatStart = dv.getUint32(68, true);
  const numDIFAT = dv.getUint32(72, true);

  const sectorOffset = (s: number): number => (s + 1) * sectorSize;

  // Assemble the DIFAT: 109 entries live in the header, the rest in a chain.
  const difat: number[] = [];
  for (let i = 0; i < 109; i++) {
    const v = dv.getUint32(76 + i * 4, true);
    if (v === 0xffffffff) break;
    difat.push(v);
  }
  let ds = difatStart;
  for (let n = 0; n < numDIFAT && ds !== 0xffffffff && ds !== 0xfffffffe; n++) {
    const off = sectorOffset(ds);
    const perSector = sectorSize / 4 - 1;
    for (let i = 0; i < perSector; i++) {
      const v = dv.getUint32(off + i * 4, true);
      if (v !== 0xffffffff) difat.push(v);
    }
    ds = dv.getUint32(off + perSector * 4, true);
  }

  // FAT
  const fat: number[] = [];
  for (const sec of difat.slice(0, Math.max(numFAT, difat.length))) {
    const off = sectorOffset(sec);
    if (off + sectorSize > b.length) break;
    for (let i = 0; i < sectorSize / 4; i++) fat.push(dv.getUint32(off + i * 4, true));
  }

  const chain = (start: number, fatTable: number[]): number[] => {
    const out: number[] = [];
    let s = start;
    const seen = new Set();
    while (s !== 0xfffffffe && s !== 0xffffffff && s !== 0xfffffffd && s !== undefined) {
      if (seen.has(s)) break;
      seen.add(s);
      out.push(s);
      s = fatTable[s] ?? 0xffffffff;
    }
    return out;
  };

  const readChain = (start: number, size: number | null = null): Uint8Array => {
    const secs = chain(start, fat);
    const out = new Uint8Array(secs.length * sectorSize);
    secs.forEach((s, i) => {
      const off = sectorOffset(s);
      out.set(b.subarray(off, Math.min(off + sectorSize, b.length)), i * sectorSize);
    });
    return size != null ? out.subarray(0, size) : out;
  };

  // Directory
  const dirBytes = readChain(dirStart);
  const entries: Array<{ name: string; type: number; start: number; size: number }> = [];
  for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
    const nameLen = SE(dirBytes).getUint16(off + 64, true);
    if (nameLen <= 0 || nameLen > 64) continue;
    const name = utf16le(dirBytes, off, Math.max(0, nameLen / 2 - 1));
    const type = at(dirBytes, off + 66);
    const dvd = SE(dirBytes);
    entries.push({
      name,
      type,
      start: dvd.getUint32(off + 116, true),
      size: dvd.getUint32(off + 120, true) + dvd.getUint32(off + 124, true) * 4294967296,
    });
  }

  // Mini-FAT and mini-stream (small streams live inside the root entry's stream)
  const root = entries.find((e) => e.type === 5);
  let miniFAT: number[] = [];
  if (numMiniFAT) {
    const mb = readChain(miniFATStart);
    const mdv = SE(mb);
    for (let i = 0; i + 4 <= mb.length; i += 4) miniFAT.push(mdv.getUint32(i, true));
  }
  const miniStream = root && root.size ? readChain(root.start, root.size) : new Uint8Array(0);

  const readStream = (entry: { start: number; size: number }) => {
    if (entry.size < miniCutoff && root) {
      const secs = chain(entry.start, miniFAT);
      const out = new Uint8Array(secs.length * miniSectorSize);
      secs.forEach((s, i) => {
        const off = s * miniSectorSize;
        out.set(miniStream.subarray(off, off + miniSectorSize), i * miniSectorSize);
      });
      return out.subarray(0, entry.size);
    }
    return readChain(entry.start, entry.size);
  };

  return { entries, readStream };
}

/* ------------------------------------------------------------------- BIFF8 */

/** Cursor over a BIFF record that transparently walks into CONTINUE records. */
interface BiffCursor {
  remaining(): number;
  byte(): number;
  u16(): number;
  i32(): number;
  skip(n: number): void;
  latin1(n: number): string;
  utf16(n: number): string;
  nextBlock(): boolean;
  atEnd(): boolean;
}

/* Read an XLUnicodeString whose length has already been read, honouring the
   CONTINUE-record boundaries the caller supplies via `next`. */
function biffString(rd: BiffCursor, cch: number, flagsByte: number): string {
  let high = flagsByte & 0x01;
  let out = '';
  let left = cch;
  while (left > 0) {
    const avail = rd.remaining();
    if (avail <= 0) {
      if (!rd.nextBlock()) break;
      high = rd.byte() & 0x01;
      continue;
    }
    const take = high ? Math.min(left, Math.floor(avail / 2)) : Math.min(left, avail);
    if (take <= 0) {
      if (!rd.nextBlock()) break;
      high = rd.byte() & 0x01;
      continue;
    }
    out += high ? rd.utf16(take) : rd.latin1(take);
    left -= take;
  }
  return out;
}

function rkToNumber(rk: number): number {
  const isInt = (rk & 0x02) !== 0;
  const div100 = (rk & 0x01) !== 0;
  let v;
  if (isInt) {
    v = rk >> 2;
  } else {
    const buf = new ArrayBuffer(8);
    const d = new DataView(buf);
    d.setUint32(0, 0, true);
    d.setInt32(4, rk & 0xfffffffc, true);
    v = d.getFloat64(0, true);
  }
  return div100 ? v / 100 : v;
}

function parseXLS(buf: ArrayBuffer): Workbook {
  const { entries, readStream } = readCFB(buf);
  const wbEntry = entries.find((e) => e.type === 2 && /^(Workbook|Book)$/i.test(e.name));
  if (!wbEntry) throw new Error('no Workbook stream');
  const s = readStream(wbEntry);
  const dv = SE(s);

  // Pass 1: walk every record, keeping the globals we need.
  const records: Array<{ id: number; start: number; len: number; pos: number }> = [];
  let p = 0;
  while (p + 4 <= s.length) {
    const id = dv.getUint16(p, true);
    const len = dv.getUint16(p + 2, true);
    if (p + 4 + len > s.length) break;
    records.push({ id, start: p + 4, len, pos: p });
    p += 4 + len;
  }

  const boundsheets: Array<{ pos: number; name: string; hidden: boolean }> = [];
  const xfFmt: number[] = [];
  const formats: Record<number, string> = {};
  let date1904 = false;
  const sst: string[] = [];

  const readerOver = (idx: number): BiffCursor => {
    // A cursor that transparently walks into CONTINUE records.
    let i = idx;
    let off = records[i]!.start;
    let end = records[i]!.start + records[i]!.len;
    return {
      remaining: () => end - off,
      byte() { return at(s, off++); },
      u16() { const v = dv.getUint16(off, true); off += 2; return v; },
      i32() { const v = dv.getInt32(off, true); off += 4; return v; },
      skip(n: number) { off += n; },
      latin1(n: number) { const v = latin1(s, off, n); off += n; return v; },
      utf16(n: number) { const v = utf16le(s, off, n); off += n * 2; return v; },
      nextBlock() {
        if (i + 1 < records.length && records[i + 1]!.id === 0x003c) {
          i += 1;
          off = records[i]!.start;
          end = records[i]!.start + records[i]!.len;
          return true;
        }
        return false;
      },
      atEnd() { return off >= end && !(records[i + 1] && records[i + 1]!.id === 0x003c); },
    };
  };

  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    const o = r.start;
    if (r.id === 0x0085) {
      // BOUNDSHEET
      const pos = dv.getUint32(o, true);
      const cch = at(s, o + 6);
      const flags = at(s, o + 7);
      const name = flags & 0x01 ? utf16le(s, o + 8, cch) : latin1(s, o + 8, cch);
      boundsheets.push({ name, pos, hidden: (at(s, o + 4) & 0x03) !== 0 });
    } else if (r.id === 0x0022) {
      date1904 = dv.getUint16(o, true) === 1;
    } else if (r.id === 0x00e0) {
      xfFmt.push(dv.getUint16(o + 2, true));
    } else if (r.id === 0x041e) {
      const ifmt = dv.getUint16(o, true);
      const cch = dv.getUint16(o + 2, true);
      const flags = at(s, o + 4);
      formats[ifmt] = flags & 0x01 ? utf16le(s, o + 5, cch) : latin1(s, o + 5, cch);
    } else if (r.id === 0x00fc) {
      // SST
      const rd = readerOver(i);
      rd.skip(4);
      const unique = rd.i32();
      for (let n = 0; n < unique; n++) {
        if (rd.remaining() < 3 && !rd.nextBlock()) break;
        const cch = rd.u16();
        const flags = rd.byte();
        let cRun = 0;
        let cbExt = 0;
        if (flags & 0x08) cRun = rd.u16();
        if (flags & 0x04) cbExt = rd.i32();
        sst.push(biffString(rd, cch, flags));
        let toSkip = cRun * 4 + cbExt;
        while (toSkip > 0) {
          const avail = rd.remaining();
          if (avail <= 0) { if (!rd.nextBlock()) break; continue; }
          const take = Math.min(avail, toSkip);
          rd.skip(take);
          toSkip -= take;
        }
      }
    }
  }

  const isDateXF = (ixfe: number): boolean => {
    const ifmt = xfFmt[ixfe];
    if (ifmt == null) return false;
    if (formats[ifmt] != null) return fmtIsDate(formats[ifmt]);
    return BUILTIN_DATE_FMT.has(ifmt);
  };

  // Pass 2: per-sheet cell records, delimited by each BOUNDSHEET's stream offset.
  const recAt = new Map(records.map((r) => [r.pos, r]));
  const sheets: Array<{ name: string; rows: Array<Array<SpreadsheetCell | null>> }> = [];
  for (let si = 0; si < boundsheets.length; si++) {
    const bs = boundsheets[si]!;
    const startIdx = records.findIndex((r) => r.pos === bs.pos);
    if (startIdx < 0) continue;
    const rows: Array<Array<SpreadsheetCell | null>> = [];
    const put = (row: number, col: number, cell: SpreadsheetCell): void => {
      if (!rows[row]) rows[row] = [];
      rows[row]![col] = cell;
    };
    for (let i = startIdx + 1; i < records.length; i++) {
      const r = records[i]!;
      if (r.id === 0x000a) break; // EOF of this substream
      const o = r.start;
      if (r.id === 0x00fd) {
        // LABELSST
        const row = dv.getUint16(o, true), col = dv.getUint16(o + 2, true);
        put(row, col, { t: 's', v: sst[dv.getUint32(o + 6, true)] ?? '' });
      } else if (r.id === 0x0204) {
        // LABEL
        const row = dv.getUint16(o, true), col = dv.getUint16(o + 2, true);
        const cch = dv.getUint16(o + 6, true);
        const flags = at(s, o + 8);
        put(row, col, { t: 's', v: flags & 0x01 ? utf16le(s, o + 9, cch) : latin1(s, o + 9, cch) });
      } else if (r.id === 0x0203) {
        // NUMBER
        const row = dv.getUint16(o, true), col = dv.getUint16(o + 2, true);
        const ixfe = dv.getUint16(o + 4, true);
        const v = dv.getFloat64(o + 6, true);
        put(row, col, isDateXF(ixfe) ? { t: 'd', v: serialToDate(v, date1904) } : { t: 'n', v });
      } else if (r.id === 0x027e) {
        // RK
        const row = dv.getUint16(o, true), col = dv.getUint16(o + 2, true);
        const ixfe = dv.getUint16(o + 4, true);
        const v = rkToNumber(dv.getInt32(o + 6, true));
        put(row, col, isDateXF(ixfe) ? { t: 'd', v: serialToDate(v, date1904) } : { t: 'n', v });
      } else if (r.id === 0x00bd) {
        // MULRK
        const row = dv.getUint16(o, true);
        const colFirst = dv.getUint16(o + 2, true);
        const n = (r.len - 6) / 6;
        for (let k = 0; k < n; k++) {
          const ixfe = dv.getUint16(o + 4 + k * 6, true);
          const v = rkToNumber(dv.getInt32(o + 6 + k * 6, true));
          put(row, colFirst + k, isDateXF(ixfe) ? { t: 'd', v: serialToDate(v, date1904) } : { t: 'n', v });
        }
      } else if (r.id === 0x0006) {
        // FORMULA — cached result only
        const row = dv.getUint16(o, true), col = dv.getUint16(o + 2, true);
        const ixfe = dv.getUint16(o + 4, true);
        if (dv.getUint16(o + 12, true) === 0xffff) {
          const kind = at(s, o + 6);
          if (kind === 0) {
            // string result arrives in the following STRING record
            const nxt = records[i + 1];
            let str = '';
            if (nxt && nxt.id === 0x0207) {
              const cch = dv.getUint16(nxt.start, true);
              const flags = at(s, nxt.start + 2);
              str = flags & 0x01 ? utf16le(s, nxt.start + 3, cch) : latin1(s, nxt.start + 3, cch);
            }
            put(row, col, { t: 's', v: str });
          } else if (kind === 1) {
            put(row, col, { t: 'b', v: at(s, o + 8) !== 0 });
          } else if (kind === 2) {
            put(row, col, { t: 'e', v: at(s, o + 8) });
          }
        } else {
          const v = dv.getFloat64(o + 6, true);
          put(row, col, isDateXF(ixfe) ? { t: 'd', v: serialToDate(v, date1904) } : { t: 'n', v });
        }
      }
    }
    sheets.push({ name: bs.name, rows: densify(rows) });
  }
  return { sheets };
}

/* -------------------------------------------------------------------- XLSX */

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf: ArrayBuffer): Promise<Record<string, Uint8Array>> {
  const b = new Uint8Array(buf);
  const dv = SE(b);
  // locate End Of Central Directory
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const files: Record<string, { method: number; bytes: Uint8Array }> = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const cmtLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(b.subarray(off + 46, off + 46 + nameLen));
    const lNameLen = dv.getUint16(lho + 26, true);
    const lExtraLen = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    files[name] = { method, bytes: b.subarray(dataStart, dataStart + csize) };
    off += 46 + nameLen + extraLen + cmtLen;
  }
  const out: Record<string, Uint8Array> = {};
  for (const [name, f] of Object.entries(files)) {
    out[name] = f.method === 0 ? f.bytes : await inflateRaw(f.bytes);
  }
  return out;
}

const XMLDEC = new TextDecoder();
function xmlDoc(bytes: Uint8Array): Document {
  return new DOMParser().parseFromString(XMLDEC.decode(bytes), 'application/xml');
}
function colFromRef(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/* A workbook may prefix every element — Isracard's export is <x:workbook>, <x:sheet>,
   <x:row>, <x:c> — and a lookup by qualified name then matches none of them. The reader
   found no sheets at all in such a file, which reached the customer as "we could not open
   it". Matching on local name reads both spellings, and is what parseSpreadsheetML already
   had to do for the same reason. */
const tags = (root: Document | Element, name: string): Element[] => [...root.getElementsByTagNameNS('*', name)];

async function parseXLSX(buf: ArrayBuffer): Promise<Workbook> {
  const zip = await unzip(buf);
  const get = (p: string): Uint8Array | undefined => zip[p] || zip[p.replace(/^xl\//, '')];

  // shared strings
  let shared: string[] = [];
  if (get('xl/sharedStrings.xml')) {
    const doc = xmlDoc(get('xl/sharedStrings.xml')!);
    shared = tags(doc, 'si').map((si) =>
      tags(si, 't').map((t) => t.textContent ?? '').join(''));
  }

  // styles → which cellXfs indices are dates
  const dateXf: boolean[] = [];
  let date1904 = false;
  if (get('xl/styles.xml')) {
    const doc = xmlDoc(get('xl/styles.xml')!);
    const custom: Record<number, string> = {};
    for (const nf of tags(doc, 'numFmt')) {
      custom[Number(nf.getAttribute('numFmtId'))] = nf.getAttribute('formatCode') || '';
    }
    const cellXfs = tags(doc, 'cellXfs')[0];
    if (cellXfs) {
      for (const xf of tags(cellXfs, 'xf')) {
        const id = +(xf.getAttribute('numFmtId') || 0);
        dateXf.push(custom[id] != null ? fmtIsDate(custom[id]) : BUILTIN_DATE_FMT.has(id));
      }
    }
  }
  if (get('xl/workbook.xml')) {
    const doc = xmlDoc(get('xl/workbook.xml')!);
    const pr = tags(doc, 'workbookPr')[0];
    if (pr && (pr.getAttribute('date1904') === '1' || pr.getAttribute('date1904') === 'true')) date1904 = true;
  }

  // sheet order & names
  const wb = xmlDoc(get('xl/workbook.xml')!);
  const rels = xmlDoc(get('xl/_rels/workbook.xml.rels')!);
  const relMap: Record<string, string> = {};
  for (const r of tags(rels, 'Relationship')) {
    const relId = r.getAttribute('Id');
    if (relId) relMap[relId] = (r.getAttribute('Target') || '').replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sheets: Array<{ name: string; rows: Array<Array<SpreadsheetCell | null>> }> = [];
  for (const sh of tags(wb, 'sheet')) {
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = rid ? relMap[rid] : undefined;
    const bytes = target ? get('xl/' + target) : undefined;
    const rows: Array<Array<SpreadsheetCell | null>> = [];
    if (bytes) {
      const doc = xmlDoc(bytes);
      /* r="A1" and r="1" are optional in the format, and writers that leave them out
         parsed as NaN — which silently dropped every cell in the file. Position then
         comes from document order, exactly as the format intends. */
      let nextRow = 0;
      for (const row of tags(doc, 'row')) {
        const declaredRow = Number.parseInt(row.getAttribute('r') ?? '', 10);
        const ri = Number.isFinite(declaredRow) && declaredRow > 0 ? declaredRow - 1 : nextRow;
        nextRow = ri + 1;
        let nextColumn = 0;
        for (const c of tags(row, 'c')) {
          const declaredColumn = colFromRef(c.getAttribute('r') ?? '');
          const ci = declaredColumn >= 0 ? declaredColumn : nextColumn;
          nextColumn = ci + 1;
          const t = c.getAttribute('t');
          const sIdx = +(c.getAttribute('s') || 0);
          const isEl = tags(c, 'is')[0];
          const vEl = tags(c, 'v')[0];
          let cell = null;
          if (t === 'inlineStr' && isEl) {
            cell = { t: 's', v: tags(isEl, 't').map((x) => x.textContent ?? '').join('') };
          } else if (!vEl) {
            cell = null;
          } else if (t === 's') {
            cell = { t: 's', v: shared[Number(vEl.textContent)] ?? '' };
          } else if (t === 'str') {
            cell = { t: 's', v: vEl.textContent ?? '' };
          } else if (t === 'b') {
            cell = { t: 'b', v: vEl.textContent === '1' };
          } else if (t === 'e') {
            cell = { t: 'e', v: vEl.textContent ?? '' };
          } else {
            const num = parseFloat(vEl.textContent ?? '');
            cell = dateXf[sIdx] ? { t: 'd', v: serialToDate(num, date1904) } : { t: 'n', v: num };
          }
          if (cell) {
            if (!rows[ri]) rows[ri] = [];
            rows[ri]![ci] = cell;
          }
        }
      }
    }
    sheets.push({ name: sh.getAttribute('name') ?? '', rows: densify(rows) });
  }
  return { sheets };
}

/* --------------------------------------------------------------------- CSV */

export function parseCSV(text: string, name = 'CSV'): Workbook {
  const rows: Array<Array<SpreadsheetCell | null>> = [];
  let row: Array<SpreadsheetCell | null> = [], field = '', quoted = false;
  const pushField = () => { row.push(field === '' ? null : { t: 's', v: field }); field = ''; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === '\t' || ch === ';') pushField();
    else if (ch === '\n') { pushField(); rows.push(row); row = []; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { pushField(); rows.push(row); }
  return { sheets: [{ name, rows }] };
}

/* -------------------------------------------------------------------- HTML */

/* Several Israeli banks export a file named .xls that is really an HTML document
   with a <table> in it. Excel opens it, so the bank calls it a spreadsheet, and
   every real spreadsheet parser rejects it. The table itself is ordinary, so
   reading it as one is cheap and covers those exports. Only textContent is ever
   read: markup in a bank-controlled cell stays text and never becomes nodes. */

/** A colspan/rowspan, clamped. A broken or hostile span must not be allowed to
    allocate an arbitrarily wide row. */
function spanOf(element: Element, attribute: string): number {
  const parsed = Number.parseInt(element.getAttribute(attribute) ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 1 ? Math.min(parsed, 64) : 1;
}

/* Empty cells stay holes rather than empty strings, matching parseCSV, so that
   findHeader sees the same shape whichever format the statement arrived in. */
function htmlCell(element: Element): SpreadsheetCell | null {
  const text = (element.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  return text === '' ? null : { t: 's', v: text };
}

/* A cell carrying rowspan keeps occupying its column on the rows underneath it.
   Without that, every column to its right slides one place left on those rows and
   stops lining up with the header. */
function htmlRows(table: Element): Array<Array<SpreadsheetCell | null>> {
  const rows: Array<Array<SpreadsheetCell | null>> = [];
  const carried: Array<{ cell: SpreadsheetCell | null; left: number } | undefined> = [];
  for (const tr of table.querySelectorAll('tr')) {
    const row: Array<SpreadsheetCell | null> = [];
    let column = 0;
    const fillCarried = () => {
      let carry = carried[column];
      while (carry && carry.left > 0) {
        row[column] = carry.cell;
        carry.left -= 1;
        column += 1;
        carry = carried[column];
      }
    };
    for (const element of tr.children) {
      const tag = element.tagName.toLowerCase();
      if (tag !== 'td' && tag !== 'th') continue;
      fillCarried();
      const cell = htmlCell(element);
      const across = spanOf(element, 'colspan');
      const down = spanOf(element, 'rowspan');
      for (let i = 0; i < across; i += 1) {
        // Only the first column of a spanned cell carries the value, so an amount
        // is never counted once per column it happens to stretch over.
        const value = i === 0 ? cell : null;
        row[column] = value;
        if (down > 1) carried[column] = { cell: value, left: down - 1 };
        column += 1;
      }
    }
    fillCarried();
    rows.push(row);
  }
  return rows;
}

export function parseHTMLTable(text: string, name = 'HTML'): Workbook {
  const document = new DOMParser().parseFromString(text, 'text/html');
  /* Bank exports wrap the statement in layout tables. Only the innermost tables
     hold data; a wrapper would otherwise contribute a sheet of merged nonsense. */
  const tables = [...document.querySelectorAll('table')].filter((table) => !table.querySelector('table'));
  const sheets = tables
    .map((table, index) => {
      const caption = (table.querySelector('caption')?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return {
        name: caption || (index === 0 ? name : `${name} (${index + 1})`),
        rows: htmlRows(table),
      };
    })
    .filter((sheet) => sheet.rows.some((row) => row.some((cell) => cell !== null)));
  return { sheets: sheets.length ? sheets : [{ name, rows: [] }] };
}

/* ----------------------------------------------------------- SpreadsheetML */

/* "Save as Excel" on several issuer sites produces SpreadsheetML 2003: an XML
   document named .xls. Excel opens it, so the issuer calls it a spreadsheet, and it
   is neither a compound file nor a zip. Worse, its <Table> element makes the HTML
   reader claim the file — which then finds no <tr> and returns a sheet with no rows,
   so the customer is told the report is empty rather than unsupported. */
const SPREADSHEETML_NS = 'urn:schemas-microsoft-com:office:spreadsheet';

/* The namespace may be the default or carry any prefix, so attributes are read by
   namespace first and by the conventional ss: spelling only as a fallback. */
function mlAttribute(element: Element, name: string): string | null {
  return element.getAttributeNS(SPREADSHEETML_NS, name) ?? element.getAttribute(`ss:${name}`) ?? element.getAttribute(name);
}

function mlCell(cell: Element): SpreadsheetCell | null {
  const data = [...cell.getElementsByTagNameNS('*', 'Data')][0] ?? [...cell.getElementsByTagNameNS('*', 'data')][0];
  const text = (data?.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  const type = data ? mlAttribute(data, 'Type') : null;
  if (type === 'Number') {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? { t: 'n', v: parsed } : { t: 's', v: text };
  }
  if (type === 'DateTime') {
    /* The format writes no timezone, so Date would read it as local time and
       toISOString would report the day before anywhere east of UTC — every Israeli
       transaction sliding back a day. Anchoring to UTC matches serialToDate. */
    const parts = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
    if (!parts) return { t: 's', v: text };
    return { t: 'd', v: new Date(Date.UTC(
      Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]),
      Number(parts[4] ?? 0), Number(parts[5] ?? 0), Number(parts[6] ?? 0),
    )) };
  }
  return { t: 's', v: text };
}

export function parseSpreadsheetML(text: string, name = 'XML'): Workbook {
  const document = new DOMParser().parseFromString(text, 'application/xml');
  const worksheets = [...document.getElementsByTagNameNS('*', 'Worksheet')];
  const sheets = worksheets.map((worksheet, index) => {
    const rows: Array<Array<SpreadsheetCell | null>> = [];
    /* Both rows and cells may carry ss:Index and skip ahead, which is how the format
       writes a gap; ignoring it would shift every later column out of its heading. */
    let nextRow = 1;
    for (const row of [...worksheet.getElementsByTagNameNS('*', 'Row')]) {
      const rowIndex = Number(mlAttribute(row, 'Index') ?? nextRow) - 1;
      nextRow = rowIndex + 2;
      const cells: Array<SpreadsheetCell | null> = [];
      let nextColumn = 1;
      for (const cell of [...row.children].filter((child) => child.localName === 'Cell')) {
        const column = Number(mlAttribute(cell, 'Index') ?? nextColumn) - 1;
        cells[column] = mlCell(cell);
        nextColumn = column + 2 + Number(mlAttribute(cell, 'MergeAcross') ?? 0);
      }
      rows[rowIndex] = cells;
    }
    /* A skipped ss:Index leaves a hole, and a hole is not an empty row: the importers
       index into every row they walk, so each one has to be a real array. */
    for (let index = 0; index < rows.length; index += 1) rows[index] ??= [];
    return { name: mlAttribute(worksheet, 'Name') || (index === 0 ? name : `${name} (${index + 1})`), rows };
  });
  return { sheets: sheets.length ? sheets : [{ name, rows: [] }] };
}

/* Israeli bank exports are commonly windows-1255 rather than UTF-8, and decoding
   those as UTF-8 replaces every Hebrew description with U+FFFD — which then
   matches no categorisation rule and lands the transaction in "other". The
   declared charset is ASCII whichever encoding the body uses, so it can be read
   before committing to one. */
function decodeDocument(bytes: Uint8Array): string {
  const head = latin1(bytes, 0, Math.min(bytes.length, 4096));
  /* An XML export declares its encoding on the declaration rather than in a meta
     charset, and those are windows-1255 as often as bank HTML is. */
  const declared = (/charset\s*=\s*["']?\s*([\w-]+)/i.exec(head) ?? /encoding\s*=\s*["']([\w-]+)["']/i.exec(head))?.[1]?.toLowerCase();
  if (declared && !/^utf-?8$/.test(declared)) {
    try { return new TextDecoder(declared).decode(bytes); } catch { /* unknown label: fall back to UTF-8 */ }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/* ------------------------------------------------------------------ facade */

/** What the bytes turned out to be, whatever the file was named. */
export type WorkbookFormat = 'xls' | 'xlsx' | 'spreadsheetml' | 'html' | 'csv';

/* Which container a file is decides how it is read, and it is the first thing worth
   knowing when an import produces nothing — a report the customer calls Excel landing on
   `csv` says the sniffing missed. Naming the format here rather than at each call site
   keeps the diagnosis and the dispatch reading from the same rules. */
function classify(bytes: Uint8Array): { format: WorkbookFormat; text: string | null } {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return { format: 'xls', text: null };
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return { format: 'xlsx', text: null };
  const text = decodeDocument(bytes);
  if (/^\s*</.test(text) && text.includes(SPREADSHEETML_NS)) return { format: 'spreadsheetml', text };
  if (/^\s*</.test(text) && /<table/i.test(text)) return { format: 'html', text };
  return { format: 'csv', text };
}

/** The detected container, for diagnostics. Reading may still fall back — a document that
    names the SpreadsheetML namespace but yields no rows is read as HTML. */
export function workbookFormat(arrayBuffer: ArrayBuffer): WorkbookFormat {
  return classify(new Uint8Array(arrayBuffer)).format;
}

export async function readWorkbook(arrayBuffer: ArrayBuffer, filename = ''): Promise<Workbook> {
  const { format, text } = classify(new Uint8Array(arrayBuffer));
  if (format === 'xls') return parseXLS(arrayBuffer);
  if (format === 'xlsx') return parseXLSX(arrayBuffer);
  if (format === 'spreadsheetml') {
    const workbook = parseSpreadsheetML(text!, filename || 'XML');
    /* An Excel-saved HTML file can name office namespaces too, so a document that
       yields nothing here is still offered to the HTML reader below. */
    if (workbook.sheets.some((sheet) => sheet.rows.length)) return workbook;
    return parseHTMLTable(text!, filename || 'HTML');
  }
  if (format === 'html') return parseHTMLTable(text!, filename || 'HTML');
  return parseCSV(text!, filename || 'CSV');
}
