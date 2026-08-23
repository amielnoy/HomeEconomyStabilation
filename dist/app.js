import { creditCardImporter } from './credit-card-importer.js';
import { createLocaleFormatters, formatMessage, getLocaleConfig, isSupportedLocale, resolveLocale } from './localization.js';
import { captureMarketingAttribution, trackMarketingEvent } from './marketing.js';
import { runFinancialAgents } from './financial-agents.js';
let locale = resolveLocale(localStorage.getItem('mazan-habait/locale'));
let resources = {};
let directoryOpen = window.location.hash === '#savings-directory';
/* sheetread.ts — minimal, dependency-free reader for legacy .xls (BIFF8 inside a
   CFB container), .xlsx (ZIP + SpreadsheetML) and .csv, returning
   { sheets: [ { name, rows: [ [cell,…] ] } ] } where each cell is
   { v: value, t: 's'|'n'|'d'|'b'|'e' }.  Runs unchanged in Node 18+ and in the
   browser: the only platform APIs it touches are TextDecoder and
   DecompressionStream. */
const SE = (b) => b instanceof ArrayBuffer
    ? new DataView(b)
    : new DataView(b.buffer, b.byteOffset, b.byteLength);
/* ---------------------------------------------------------------- utilities */
function utf16le(bytes, start, len) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(start, start + len * 2));
}
function latin1(bytes, start, len) {
    let s = '';
    for (let i = 0; i < len; i++)
        s += String.fromCharCode(bytes[start + i]);
    return s;
}
/* Excel serial date -> Date (UTC-anchored, so the calendar day never drifts). */
function serialToDate(serial, date1904) {
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    let days = Math.floor(serial);
    const frac = serial - days;
    // The 1900 system pretends 1900 was a leap year; serials past 60 are shifted.
    if (!date1904 && days > 60)
        days -= 0;
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
function fmtIsDate(fmt) {
    if (!fmt)
        return false;
    const stripped = fmt
        .replace(/\\./g, '')
        .replace(/"[^"]*"/g, '')
        .replace(/\[[^\]]*\]/g, '');
    return /[ymdhs]/i.test(stripped) && !/^[^ymdhs]*$/i.test(stripped);
}
/* --------------------------------------------------------------------- CFB */
function readCFB(buf) {
    const b = new Uint8Array(buf);
    const dv = SE(b);
    const sig = dv.getUint32(0, true) === 0xe011cfd0 && dv.getUint32(4, true) === 0xe11ab1a1;
    if (!sig)
        throw new Error('not a compound file');
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
    const sectorOffset = (s) => (s + 1) * sectorSize;
    // Assemble the DIFAT: 109 entries live in the header, the rest in a chain.
    const difat = [];
    for (let i = 0; i < 109; i++) {
        const v = dv.getUint32(76 + i * 4, true);
        if (v === 0xffffffff)
            break;
        difat.push(v);
    }
    let ds = difatStart;
    for (let n = 0; n < numDIFAT && ds !== 0xffffffff && ds !== 0xfffffffe; n++) {
        const off = sectorOffset(ds);
        const perSector = sectorSize / 4 - 1;
        for (let i = 0; i < perSector; i++) {
            const v = dv.getUint32(off + i * 4, true);
            if (v !== 0xffffffff)
                difat.push(v);
        }
        ds = dv.getUint32(off + perSector * 4, true);
    }
    // FAT
    const fat = [];
    for (const sec of difat.slice(0, Math.max(numFAT, difat.length))) {
        const off = sectorOffset(sec);
        if (off + sectorSize > b.length)
            break;
        for (let i = 0; i < sectorSize / 4; i++)
            fat.push(dv.getUint32(off + i * 4, true));
    }
    const chain = (start, fatTable) => {
        const out = [];
        let s = start;
        const seen = new Set();
        while (s !== 0xfffffffe && s !== 0xffffffff && s !== 0xfffffffd && s !== undefined) {
            if (seen.has(s))
                break;
            seen.add(s);
            out.push(s);
            s = fatTable[s];
        }
        return out;
    };
    const readChain = (start, size = null) => {
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
    const entries = [];
    for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
        const nameLen = SE(dirBytes).getUint16(off + 64, true);
        if (nameLen <= 0 || nameLen > 64)
            continue;
        const name = utf16le(dirBytes, off, Math.max(0, nameLen / 2 - 1));
        const type = dirBytes[off + 66];
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
    let miniFAT = [];
    if (numMiniFAT) {
        const mb = readChain(miniFATStart);
        const mdv = SE(mb);
        for (let i = 0; i + 4 <= mb.length; i += 4)
            miniFAT.push(mdv.getUint32(i, true));
    }
    const miniStream = root && root.size ? readChain(root.start, root.size) : new Uint8Array(0);
    const readStream = (entry) => {
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
/* Read an XLUnicodeString whose length has already been read, honouring the
   CONTINUE-record boundaries the caller supplies via `next`. */
function biffString(rd, cch, flagsByte) {
    let high = flagsByte & 0x01;
    let out = '';
    let left = cch;
    while (left > 0) {
        const avail = rd.remaining();
        if (avail <= 0) {
            if (!rd.nextBlock())
                break;
            high = rd.byte() & 0x01;
            continue;
        }
        const take = high ? Math.min(left, Math.floor(avail / 2)) : Math.min(left, avail);
        if (take <= 0) {
            if (!rd.nextBlock())
                break;
            high = rd.byte() & 0x01;
            continue;
        }
        out += high ? rd.utf16(take) : rd.latin1(take);
        left -= take;
    }
    return out;
}
function rkToNumber(rk) {
    const isInt = (rk & 0x02) !== 0;
    const div100 = (rk & 0x01) !== 0;
    let v;
    if (isInt) {
        v = rk >> 2;
    }
    else {
        const buf = new ArrayBuffer(8);
        const d = new DataView(buf);
        d.setUint32(0, 0, true);
        d.setInt32(4, rk & 0xfffffffc, true);
        v = d.getFloat64(0, true);
    }
    return div100 ? v / 100 : v;
}
function parseXLS(buf) {
    const { entries, readStream } = readCFB(buf);
    const wbEntry = entries.find((e) => e.type === 2 && /^(Workbook|Book)$/i.test(e.name));
    if (!wbEntry)
        throw new Error('no Workbook stream');
    const s = readStream(wbEntry);
    const dv = SE(s);
    // Pass 1: walk every record, keeping the globals we need.
    const records = [];
    let p = 0;
    while (p + 4 <= s.length) {
        const id = dv.getUint16(p, true);
        const len = dv.getUint16(p + 2, true);
        if (p + 4 + len > s.length)
            break;
        records.push({ id, start: p + 4, len, pos: p });
        p += 4 + len;
    }
    const boundsheets = [];
    const xfFmt = [];
    const formats = {};
    let date1904 = false;
    let sst = [];
    const readerOver = (idx) => {
        // A cursor that transparently walks into CONTINUE records.
        let i = idx;
        let off = records[i].start;
        let end = records[i].start + records[i].len;
        return {
            remaining: () => end - off,
            byte() { return s[off++]; },
            u16() { const v = dv.getUint16(off, true); off += 2; return v; },
            i32() { const v = dv.getInt32(off, true); off += 4; return v; },
            skip(n) { off += n; },
            latin1(n) { const v = latin1(s, off, n); off += n; return v; },
            utf16(n) { const v = utf16le(s, off, n); off += n * 2; return v; },
            nextBlock() {
                if (i + 1 < records.length && records[i + 1].id === 0x003c) {
                    i += 1;
                    off = records[i].start;
                    end = records[i].start + records[i].len;
                    return true;
                }
                return false;
            },
            atEnd() { return off >= end && !(records[i + 1] && records[i + 1].id === 0x003c); },
        };
    };
    for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const o = r.start;
        if (r.id === 0x0085) {
            // BOUNDSHEET
            const pos = dv.getUint32(o, true);
            const cch = s[o + 6];
            const flags = s[o + 7];
            const name = flags & 0x01 ? utf16le(s, o + 8, cch) : latin1(s, o + 8, cch);
            boundsheets.push({ name, pos, hidden: (s[o + 4] & 0x03) !== 0 });
        }
        else if (r.id === 0x0022) {
            date1904 = dv.getUint16(o, true) === 1;
        }
        else if (r.id === 0x00e0) {
            xfFmt.push(dv.getUint16(o + 2, true));
        }
        else if (r.id === 0x041e) {
            const ifmt = dv.getUint16(o, true);
            const cch = dv.getUint16(o + 2, true);
            const flags = s[o + 4];
            formats[ifmt] = flags & 0x01 ? utf16le(s, o + 5, cch) : latin1(s, o + 5, cch);
        }
        else if (r.id === 0x00fc) {
            // SST
            const rd = readerOver(i);
            rd.skip(4);
            const unique = rd.i32();
            for (let n = 0; n < unique; n++) {
                if (rd.remaining() < 3 && !rd.nextBlock())
                    break;
                const cch = rd.u16();
                const flags = rd.byte();
                let cRun = 0;
                let cbExt = 0;
                if (flags & 0x08)
                    cRun = rd.u16();
                if (flags & 0x04)
                    cbExt = rd.i32();
                sst.push(biffString(rd, cch, flags));
                let toSkip = cRun * 4 + cbExt;
                while (toSkip > 0) {
                    const avail = rd.remaining();
                    if (avail <= 0) {
                        if (!rd.nextBlock())
                            break;
                        continue;
                    }
                    const take = Math.min(avail, toSkip);
                    rd.skip(take);
                    toSkip -= take;
                }
            }
        }
    }
    const isDateXF = (ixfe) => {
        const ifmt = xfFmt[ixfe];
        if (ifmt == null)
            return false;
        if (formats[ifmt] != null)
            return fmtIsDate(formats[ifmt]);
        return BUILTIN_DATE_FMT.has(ifmt);
    };
    // Pass 2: per-sheet cell records, delimited by each BOUNDSHEET's stream offset.
    const recAt = new Map(records.map((r) => [r.pos, r]));
    const sheets = [];
    for (let si = 0; si < boundsheets.length; si++) {
        const bs = boundsheets[si];
        const startIdx = records.findIndex((r) => r.pos === bs.pos);
        if (startIdx < 0)
            continue;
        const rows = [];
        const put = (row, col, cell) => {
            if (!rows[row])
                rows[row] = [];
            rows[row][col] = cell;
        };
        for (let i = startIdx + 1; i < records.length; i++) {
            const r = records[i];
            if (r.id === 0x000a)
                break; // EOF of this substream
            const o = r.start;
            if (r.id === 0x00fd) {
                // LABELSST
                const row = dv.getUint16(o, true), col = dv.getUint16(o + 2, true);
                put(row, col, { t: 's', v: sst[dv.getUint32(o + 6, true)] ?? '' });
            }
            else if (r.id === 0x0204) {
                // LABEL
                const row = dv.getUint16(o, true), col = dv.getUint16(o + 2, true);
                const cch = dv.getUint16(o + 6, true);
                const flags = s[o + 8];
                put(row, col, { t: 's', v: flags & 0x01 ? utf16le(s, o + 9, cch) : latin1(s, o + 9, cch) });
            }
            else if (r.id === 0x0203) {
                // NUMBER
                const row = dv.getUint16(o, true), col = dv.getUint16(o + 2, true);
                const ixfe = dv.getUint16(o + 4, true);
                const v = dv.getFloat64(o + 6, true);
                put(row, col, isDateXF(ixfe) ? { t: 'd', v: serialToDate(v, date1904) } : { t: 'n', v });
            }
            else if (r.id === 0x027e) {
                // RK
                const row = dv.getUint16(o, true), col = dv.getUint16(o + 2, true);
                const ixfe = dv.getUint16(o + 4, true);
                const v = rkToNumber(dv.getInt32(o + 6, true));
                put(row, col, isDateXF(ixfe) ? { t: 'd', v: serialToDate(v, date1904) } : { t: 'n', v });
            }
            else if (r.id === 0x00bd) {
                // MULRK
                const row = dv.getUint16(o, true);
                const colFirst = dv.getUint16(o + 2, true);
                const n = (r.len - 6) / 6;
                for (let k = 0; k < n; k++) {
                    const ixfe = dv.getUint16(o + 4 + k * 6, true);
                    const v = rkToNumber(dv.getInt32(o + 6 + k * 6, true));
                    put(row, colFirst + k, isDateXF(ixfe) ? { t: 'd', v: serialToDate(v, date1904) } : { t: 'n', v });
                }
            }
            else if (r.id === 0x0006) {
                // FORMULA — cached result only
                const row = dv.getUint16(o, true), col = dv.getUint16(o + 2, true);
                const ixfe = dv.getUint16(o + 4, true);
                if (dv.getUint16(o + 12, true) === 0xffff) {
                    const kind = s[o + 6];
                    if (kind === 0) {
                        // string result arrives in the following STRING record
                        const nxt = records[i + 1];
                        let str = '';
                        if (nxt && nxt.id === 0x0207) {
                            const cch = dv.getUint16(nxt.start, true);
                            const flags = s[nxt.start + 2];
                            str = flags & 0x01 ? utf16le(s, nxt.start + 3, cch) : latin1(s, nxt.start + 3, cch);
                        }
                        put(row, col, { t: 's', v: str });
                    }
                    else if (kind === 1) {
                        put(row, col, { t: 'b', v: s[o + 8] !== 0 });
                    }
                    else if (kind === 2) {
                        put(row, col, { t: 'e', v: s[o + 8] });
                    }
                }
                else {
                    const v = dv.getFloat64(o + 6, true);
                    put(row, col, isDateXF(ixfe) ? { t: 'd', v: serialToDate(v, date1904) } : { t: 'n', v });
                }
            }
        }
        sheets.push({ name: bs.name, rows });
    }
    return { sheets };
}
/* -------------------------------------------------------------------- XLSX */
async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unzip(buf) {
    const b = new Uint8Array(buf);
    const dv = SE(b);
    // locate End Of Central Directory
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) {
        if (dv.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0)
        throw new Error('not a zip');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let n = 0; n < count; n++) {
        if (dv.getUint32(off, true) !== 0x02014b50)
            break;
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
    const out = {};
    for (const [name, f] of Object.entries(files)) {
        out[name] = f.method === 0 ? f.bytes : await inflateRaw(f.bytes);
    }
    return out;
}
const XMLDEC = new TextDecoder();
function xmlDoc(bytes) {
    return new DOMParser().parseFromString(XMLDEC.decode(bytes), 'application/xml');
}
function colFromRef(ref) {
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
        const c = ref.charCodeAt(i);
        if (c < 65 || c > 90)
            break;
        n = n * 26 + (c - 64);
    }
    return n - 1;
}
async function parseXLSX(buf) {
    const zip = await unzip(buf);
    const get = (p) => zip[p] || zip[p.replace(/^xl\//, '')];
    // shared strings
    let shared = [];
    if (get('xl/sharedStrings.xml')) {
        const doc = xmlDoc(get('xl/sharedStrings.xml'));
        shared = [...doc.getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
    }
    // styles → which cellXfs indices are dates
    const dateXf = [];
    let date1904 = false;
    if (get('xl/styles.xml')) {
        const doc = xmlDoc(get('xl/styles.xml'));
        const custom = {};
        for (const nf of doc.getElementsByTagName('numFmt')) {
            custom[+nf.getAttribute('numFmtId')] = nf.getAttribute('formatCode') || '';
        }
        const cellXfs = doc.getElementsByTagName('cellXfs')[0];
        if (cellXfs) {
            for (const xf of cellXfs.getElementsByTagName('xf')) {
                const id = +(xf.getAttribute('numFmtId') || 0);
                dateXf.push(custom[id] != null ? fmtIsDate(custom[id]) : BUILTIN_DATE_FMT.has(id));
            }
        }
    }
    if (get('xl/workbook.xml')) {
        const doc = xmlDoc(get('xl/workbook.xml'));
        const pr = doc.getElementsByTagName('workbookPr')[0];
        if (pr && (pr.getAttribute('date1904') === '1' || pr.getAttribute('date1904') === 'true'))
            date1904 = true;
    }
    // sheet order & names
    const wb = xmlDoc(get('xl/workbook.xml'));
    const rels = xmlDoc(get('xl/_rels/workbook.xml.rels'));
    const relMap = {};
    for (const r of rels.getElementsByTagName('Relationship')) {
        relMap[r.getAttribute('Id')] = r.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, '');
    }
    const sheets = [];
    for (const sh of wb.getElementsByTagName('sheet')) {
        const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        const target = relMap[rid];
        const bytes = get('xl/' + target);
        const rows = [];
        if (bytes) {
            const doc = xmlDoc(bytes);
            for (const row of doc.getElementsByTagName('row')) {
                const ri = +row.getAttribute('r') - 1;
                for (const c of row.getElementsByTagName('c')) {
                    const ci = colFromRef(c.getAttribute('r') || '');
                    const t = c.getAttribute('t');
                    const sIdx = +(c.getAttribute('s') || 0);
                    const isEl = c.getElementsByTagName('is')[0];
                    const vEl = c.getElementsByTagName('v')[0];
                    let cell = null;
                    if (t === 'inlineStr' && isEl) {
                        cell = { t: 's', v: [...isEl.getElementsByTagName('t')].map((x) => x.textContent).join('') };
                    }
                    else if (!vEl) {
                        cell = null;
                    }
                    else if (t === 's') {
                        cell = { t: 's', v: shared[+vEl.textContent] ?? '' };
                    }
                    else if (t === 'str') {
                        cell = { t: 's', v: vEl.textContent };
                    }
                    else if (t === 'b') {
                        cell = { t: 'b', v: vEl.textContent === '1' };
                    }
                    else if (t === 'e') {
                        cell = { t: 'e', v: vEl.textContent };
                    }
                    else {
                        const num = parseFloat(vEl.textContent);
                        cell = dateXf[sIdx] ? { t: 'd', v: serialToDate(num, date1904) } : { t: 'n', v: num };
                    }
                    if (cell) {
                        if (!rows[ri])
                            rows[ri] = [];
                        rows[ri][ci] = cell;
                    }
                }
            }
        }
        sheets.push({ name: sh.getAttribute('name'), rows });
    }
    return { sheets };
}
/* --------------------------------------------------------------------- CSV */
function parseCSV(text, name = 'CSV') {
    const rows = [];
    let row = [], field = '', quoted = false;
    const pushField = () => { row.push(field === '' ? null : { t: 's', v: field }); field = ''; };
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                }
                else
                    quoted = false;
            }
            else
                field += ch;
        }
        else if (ch === '"')
            quoted = true;
        else if (ch === ',' || ch === '\t' || ch === ';')
            pushField();
        else if (ch === '\n') {
            pushField();
            rows.push(row);
            row = [];
        }
        else if (ch !== '\r')
            field += ch;
    }
    if (field !== '' || row.length) {
        pushField();
        rows.push(row);
    }
    return { sheets: [{ name, rows }] };
}
/* ------------------------------------------------------------------ facade */
async function readWorkbook(arrayBuffer, filename = '') {
    const b = new Uint8Array(arrayBuffer);
    if (b[0] === 0xd0 && b[1] === 0xcf)
        return parseXLS(arrayBuffer);
    if (b[0] === 0x50 && b[1] === 0x4b)
        return parseXLSX(arrayBuffer);
    const text = new TextDecoder('utf-8').decode(b);
    if (/^\s*</.test(text) && /<table/i.test(text))
        throw new Error('HTML_TABLE');
    return parseCSV(text, filename || 'CSV');
}
/* =====================================================================
   מאזן הבית — app logic
   ===================================================================== */
(function () {
    'use strict';
    /* ------------------------------------------------------------ helpers -- */
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const el = (tag, attrs = {}, kids = null) => {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null || v === false)
                continue;
            if (k === 'class')
                n.className = String(v);
            else if (k === 'text')
                n.textContent = String(v);
            else if (k.startsWith('on') && typeof v === 'function')
                n.addEventListener(k.slice(2), v);
            else
                n.setAttribute(k, v === true ? '' : String(v));
        }
        if (kids)
            for (const k of (Array.isArray(kids) ? kids : [kids]))
                if (k != null)
                    n.append(k);
        return n;
    };
    const renderTooltip = (tip, heading, rows) => {
        tip.textContent = '';
        tip.append(el('div', { class: 't-h', text: heading }));
        for (const [label, value] of rows) {
            tip.append(el('div', { class: 't-r' }, [el('span', { text: label }), el('span', { text: value })]));
        }
    };
    const SVGNS = 'http://www.w3.org/2000/svg';
    const s = (t, a = {}) => {
        const n = document.createElementNS(SVGNS, t);
        if (a)
            for (const [k, v] of Object.entries(a))
                if (v != null)
                    n.setAttribute(k, String(v));
        return n;
    };
    let ILS0 = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
    let ILS2 = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let NUM0 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
    let ILS0S = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', signDisplay: 'always', maximumFractionDigits: 0 });
    let ILS2S = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', signDisplay: 'always', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let DDMM = new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit' });
    let DDMMYY = new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
    let MONTH_LONG = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' });
    let MONTH_SHORT = new Intl.DateTimeFormat('he-IL', { month: 'short' });
    const money = (v) => ILS0.format(Math.round(v || 0));
    const money2 = (v) => ILS2.format(v || 0);
    const moneyS = (v) => ILS0S.format(Math.round(v || 0));
    const money2S = (v) => ILS2S.format(v || 0);
    const DAY = 86400000;
    const iso = (d) => d.toISOString().slice(0, 10);
    const dOf = (isoStr) => new Date(isoStr + 'T00:00:00Z');
    const monthKey = (isoStr) => isoStr.slice(0, 7);
    const monthLabel = (mk) => MONTH_LONG.format(new Date(mk + '-01T00:00:00Z'));
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const median = (arr) => {
        if (!arr.length)
            return 0;
        const a = [...arr].sort((x, y) => x - y);
        const m = a.length >> 1;
        return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    };
    const t = (key, params = {}) => {
        const template = String(resources[key] ?? key);
        return formatMessage(template, params);
    };
    function applyLocale() {
        const root = document.documentElement;
        const config = getLocaleConfig(locale);
        root.lang = locale;
        root.dir = config.dir;
        root.dataset.locale = locale;
        $('.app').setAttribute('dir', root.dir);
        $('.drawer').setAttribute('dir', root.dir);
        document.querySelectorAll('[data-i18n]').forEach((node) => {
            const key = node.dataset.i18n;
            if (key)
                node.textContent = t(key);
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
            node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
        });
        document.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
            node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
        });
        const localeSelect = document.querySelector('#locale-select');
        localeSelect.value = locale;
        localeSelect.setAttribute('aria-label', t('languageLabel'));
        const formatters = createLocaleFormatters(locale);
        ILS0 = formatters.money0;
        ILS2 = formatters.money2;
        NUM0 = formatters.number0;
        ILS0S = formatters.money0Signed;
        ILS2S = formatters.money2Signed;
        DDMM = formatters.dayMonth;
        DDMMYY = formatters.shortDate;
        MONTH_LONG = formatters.longMonth;
        MONTH_SHORT = formatters.shortMonth;
    }
    /* Strip bidi controls and collapse the slash-separated fragments the bank
       uses inside one description field. */
    const BIDI = /[‎‏‪-‮⁦-⁩]/g;
    const clean = (v) => String(v == null ? '' : v).replace(BIDI, '').replace(/\s+/g, ' ').trim();
    /* The בנק exports numbers as text often enough that this has to be forgiving. */
    function toNum(cell) {
        if (cell == null)
            return 0;
        const v = cell.v !== undefined ? cell.v : cell;
        if (typeof v === 'number')
            return v;
        if (v instanceof Date)
            return 0;
        const t = String(v).replace(BIDI, '').replace(/[₪,\s]/g, '').replace(/[()]/g, '');
        if (t === '' || t === '-')
            return 0;
        const n = parseFloat(t);
        return isFinite(n) ? n : 0;
    }
    function toDate(cell) {
        if (cell == null)
            return null;
        const v = cell.v !== undefined ? cell.v : cell;
        if (v instanceof Date)
            return iso(v);
        const t = clean(v);
        let m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
        if (m) {
            let [, dd, mm, yy] = m;
            yy = yy.length === 2 ? '20' + yy : yy;
            return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        }
        m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m)
            return m[0];
        return null;
    }
    /* ---------------------------------------------------------- categories -- */
    /* Slot order is fixed and never cycled: the first eight categories carry the
       validated categorical hues, anything past them takes the neutral. */
    const SLOT = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
    const catColor = (cats, id) => {
        if (id === 'income')
            return 'var(--good)';
        const i = cats.filter((c) => c.id !== 'income').findIndex((c) => c.id === id);
        return i >= 0 && i < 8 ? SLOT[i] : 'var(--s0)';
    };
    const DEFAULT_CATS = [
        { id: 'credit', name: 'כרטיסי אשראי', kind: 'expense' },
        { id: 'home', name: 'דיור וחשבונות', kind: 'expense' },
        { id: 'food', name: 'סופר ומזון', kind: 'expense' },
        { id: 'cash', name: 'מזומן ומשיכות', kind: 'expense' },
        { id: 'transit', name: 'תחבורה ודלק', kind: 'expense' },
        { id: 'health', name: 'בריאות וביטוח', kind: 'expense' },
        { id: 'savings', name: 'חיסכון והעברות', kind: 'neutral' },
        { id: 'fees', name: 'עמלות וריבית', kind: 'expense' },
        { id: 'other', name: 'אחר', kind: 'expense' },
        { id: 'income', name: 'הכנסות', kind: 'income' },
    ];
    const DEFAULT_RULES = [
        ['משיכה מבנקט', 'cash'], ['משיכת מזומן', 'cash'], ['בנקט', 'cash'], ['כספומט', 'cash'],
        ['ישראכרט', 'credit'], ['כאל', 'credit'], ['כ.א.ל', 'credit'], ['ויזה', 'credit'],
        ['מקס איט', 'credit'], ['לאומי קארד', 'credit'], ['אמריקן אקספרס', 'credit'], ['דיינרס', 'credit'],
        ['חשמל', 'home'], ['מקורות', 'home'], ['תאגיד מים', 'home'], ['ארנונה', 'home'], ['עיריי', 'home'],
        ['בזק', 'home'], ['הוט', 'home'], ['סלקום', 'home'], ['פרטנר', 'home'], ['פלאפון', 'home'],
        ['ועד בית', 'home'], ['שכירות', 'home'], ['משכנתא', 'home'], ['פזגז', 'home'], ['סופרגז', 'home'],
        ['אמישראגז', 'home'],
        ['שופרסל', 'food'], ['רמי לוי', 'food'], ['ויקטורי', 'food'], ['יינות ביתן', 'food'],
        ['אושר עד', 'food'], ['טיב טעם', 'food'], ['יוחננוף', 'food'], ['מגה בעיר', 'food'],
        ['פז ', 'transit'], ['דלק ', 'transit'], ['סונול', 'transit'], ['דור אלון', 'transit'],
        ['רב קו', 'transit'], ['רב-קו', 'transit'], ['פנגו', 'transit'], ['סלופארק', 'transit'],
        ['חניון', 'transit'], ['רכבת', 'transit'], ['אגד', 'transit'],
        ['מכבי', 'health'], ['כללית', 'health'], ['מאוחדת', 'health'], ['לאומית שר', 'health'],
        ['ביטוח', 'health'], ['הראל', 'health'], ['מגדל', 'health'], ['מנורה', 'health'], ['הפניקס', 'health'],
        ['עמלה', 'fees'], ['עמלות', 'fees'], ['עמלת', 'fees'], ['דמי כרטיס', 'fees'], ['ריבית', 'fees'], ['דמי ניהול', 'fees'], ['דמי כרטיס', 'fees'],
        ['העברה', 'savings'], ['הפקדה', 'savings'], ['חיסכון', 'savings'], ['קרן השתלמות', 'savings'],
        ['גמל', 'savings'], ['פיקדון', 'savings'], ['ניירות ערך', 'savings'],
        ['משכורת', 'income'], ['שכר', 'income'], ['ביטוח לאומי', 'income'], ['קצבה', 'income'],
    ].map(([match, cat], i) => ({ id: 'r' + i, match, cat }));
    /* --------------------------------------------------------------- state -- */
    const KEY = 'mazan-habait/v1';
    let S = {
        tx: [], // ingested transactions
        overrides: {}, // txId -> category id (manual, wins over rules)
        rules: DEFAULT_RULES,
        cats: DEFAULT_CATS,
        budgets: {}, // catId -> monthly ceiling
        accounts: [],
        month: null,
    };
    function load() {
        try {
            const raw = localStorage.getItem(KEY);
            if (!raw)
                return;
            const p = JSON.parse(raw);
            S = Object.assign(S, p, { month: null });
            if (!Array.isArray(S.cats) || !S.cats.length)
                S.cats = DEFAULT_CATS;
            if (!Array.isArray(S.rules))
                S.rules = DEFAULT_RULES;
        }
        catch (e) { /* storage blocked or corrupt — start clean */ }
    }
    function save() {
        try {
            localStorage.setItem(KEY, JSON.stringify({
                tx: S.tx, overrides: S.overrides, rules: S.rules,
                cats: S.cats, budgets: S.budgets, accounts: S.accounts,
            }));
        }
        catch (e) {
            toast(t('storageSaveError'));
        }
    }
    /* --------------------------------------------------------------- toast -- */
    let toastT;
    function toast(msg) {
        const t = $('#toast');
        t.textContent = msg;
        t.classList.add('on');
        clearTimeout(toastT);
        toastT = setTimeout(() => t.classList.remove('on'), 3400);
    }
    /* ------------------------------------------------------------- ingest --- */
    const HEAD = {
        date: [/^תאריך$/, /^תאריך\s*פעולה/, /^תאריך\s*עסקה/, /מועד\s*עסקה/],
        vdate: [/תאריך\s*ערך/],
        ref: [/אסמכתא/, /מספר\s*אסמכתא/],
        desc: [/תיאור\s*פעולה/, /^תיאור$/, /פרטים/, /^סוג\s*תנועה/, /שם\s*בית\s*עסק/, /בית\s*עסק/, /שם\s*העסק/, /ספק/],
        out: [/^חובה/, /^חיוב/, /^יציאה/, /סכום\s*חיוב/, /סכום\s*עסקה/],
        in: [/^זכות/, /^זיכוי/, /^כניסה/],
        amt: [/^סכום/],
        bal: [/יתרה/],
    };
    function matchHeader(text) {
        const t = clean(text);
        for (const [key, pats] of Object.entries(HEAD))
            if (pats.some((p) => p.test(t)))
                return key;
        return null;
    }
    /* Find the header row in a sheet and map column index -> field. */
    function findHeader(rows) {
        for (let r = 0; r < Math.min(rows.length, 30); r++) {
            const row = rows[r];
            if (!row)
                continue;
            const map = {};
            let hits = 0;
            row.forEach((cell, c) => {
                if (!cell || cell.t !== 's')
                    return;
                const k = matchHeader(cell.v);
                if (k && map[k] === undefined) {
                    map[k] = c;
                    hits++;
                }
            });
            if (map.date !== undefined && map.desc !== undefined && (map.out !== undefined || map.in !== undefined || map.amt !== undefined)) {
                return { row: r, map, hits };
            }
        }
        return null;
    }
    function txId(t) {
        const raw = [t.date, t.ref, t.out.toFixed(2), t.in.toFixed(2), t.desc].join('|');
        let h = 5381;
        for (let i = 0; i < raw.length; i++)
            h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
        return h.toString(36) + '-' + raw.length.toString(36);
    }
    function ingest(wb, filename, source = 'bank') {
        const found = [];
        let account = null;
        for (const sheet of wb.sheets) {
            const rows = sheet.rows || [];
            // account number, if the export carries one in its preamble
            for (let r = 0; r < Math.min(rows.length, 12) && !account; r++) {
                const row = rows[r] || [];
                for (let c = 0; c < row.length; c++) {
                    if (row[c] && row[c].t === 's' && /^חשבון/.test(clean(row[c].v))) {
                        const next = row[c + 1];
                        if (next)
                            account = clean(next.v);
                    }
                }
            }
            const hdr = findHeader(rows);
            if (!hdr)
                continue;
            const pending = /המתנה|זמני/.test(clean(sheet.name));
            for (let r = hdr.row + 1; r < rows.length; r++) {
                const row = rows[r];
                if (!row)
                    continue;
                const date = toDate(row[hdr.map.date]);
                if (!date)
                    continue;
                const desc = clean(row[hdr.map.desc] && row[hdr.map.desc].v);
                let out = hdr.map.out !== undefined ? Math.abs(toNum(row[hdr.map.out])) : 0;
                let inn = hdr.map.in !== undefined ? Math.abs(toNum(row[hdr.map.in])) : 0;
                if (source === 'card' && hdr.map.out !== undefined && hdr.map.in === undefined) {
                    const signedAmount = toNum(row[hdr.map.out]);
                    out = signedAmount >= 0 ? signedAmount : 0;
                    inn = signedAmount < 0 ? -signedAmount : 0;
                }
                if (hdr.map.amt !== undefined && !out && !inn) {
                    const a = toNum(row[hdr.map.amt]);
                    if (source === 'card') {
                        if (a < 0)
                            inn = -a;
                        else
                            out = a;
                    }
                    else if (a < 0)
                        out = -a;
                    else
                        inn = a;
                }
                if (!out && !inn)
                    continue;
                const bal = hdr.map.bal !== undefined ? toNum(row[hdr.map.bal]) : null;
                const t = {
                    date,
                    vdate: hdr.map.vdate !== undefined ? toDate(row[hdr.map.vdate]) || date : date,
                    ref: clean(row[hdr.map.ref] && row[hdr.map.ref].v),
                    desc, out, in: inn,
                    bal: hdr.map.bal !== undefined && bal !== 0 ? bal : null,
                    pending,
                    source,
                    src: filename,
                };
                t.id = txId(t);
                found.push(t);
            }
        }
        return { rows: found, account };
    }
    /* ---------------------------------------------------------- categorise -- */
    function autoCat(t) {
        if (S.overrides[t.id])
            return S.overrides[t.id];
        const d = t.desc.toLocaleLowerCase();
        for (const r of S.rules) {
            if (!r.match)
                continue;
            if (d.includes(r.match.toLocaleLowerCase()))
                return r.cat;
        }
        return t.in > 0 ? 'income' : 'other';
    }
    const catById = (id) => {
        const category = S.cats.find((c) => c.id === id) || { id, name: id, kind: 'expense' };
        return { ...category, name: String(resources[`cat.${id}`] ?? category.name) };
    };
    /* Amount, signed: outflow negative. Neutral categories are movements, not
       spending, so they are excluded from the income/expense totals. */
    function signed(t) { return t.in - t.out; }
    /* --------------------------------------------------------- aggregation -- */
    function decorate() {
        S.tx.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        for (const t of S.tx) {
            t.cat = autoCat(t);
            t.kind = catById(t.cat).kind;
        }
    }
    function monthsPresent() {
        const set = new Set(S.tx.map((t) => monthKey(t.date)));
        return [...set].sort().reverse();
    }
    function txOfMonth(mk) { return S.tx.filter((t) => monthKey(t.date) === mk); }
    function totals(list) {
        let inn = 0, out = 0, moved = 0;
        for (const t of list) {
            if (t.kind === 'neutral') {
                moved += Math.abs(signed(t));
                continue;
            }
            inn += t.in;
            out += t.out;
        }
        return { in: inn, out, net: inn - out, moved };
    }
    function byCategory(list) {
        const m = new Map();
        for (const t of list) {
            if (t.kind === 'income' || t.kind === 'neutral')
                continue;
            const cur = m.get(t.cat) || 0;
            m.set(t.cat, cur + t.out);
        }
        return [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    }
    /* Current balance: the running balance on the newest row that carries one. */
    function currentBalance() {
        for (const t of S.tx)
            if (t.bal != null)
                return { bal: t.bal, date: t.date };
        return null;
    }
    /* Daily balance series, reconstructed backwards from the newest known
       balance so that gaps between statements do not break the line. */
    function balanceSeries() {
        const known = S.tx.filter((t) => t.bal != null);
        if (!known.length)
            return [];
        const out = [];
        for (const t of known)
            out.push({ date: t.date, bal: t.bal });
        // one point per day: keep the last (lowest-in-list = earliest) per date
        const byDate = new Map();
        for (const p of out)
            if (!byDate.has(p.date))
                byDate.set(p.date, p.bal);
        const dates = [...byDate.keys()].sort();
        if (!dates.length)
            return [];
        const series = [];
        let cur = byDate.get(dates[0]);
        for (let d = dOf(dates[0]).getTime(); d <= dOf(dates[dates.length - 1]).getTime(); d += DAY) {
            const k = iso(new Date(d));
            if (byDate.has(k))
                cur = byDate.get(k);
            series.push({ t: d, bal: cur });
        }
        return series;
    }
    /* ---------------------------------------------------------- recurring --- */
    /* A charge is recurring when the same normalised payee shows up in at least
       two distinct months with a comparable amount. */
    function normPayee(desc) {
        return desc
            .replace(/\d{3,}/g, '')
            .replace(/[^֐-׿a-zA-Z ]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 28);
    }
    function recurring() {
        const groups = new Map();
        for (const t of S.tx) {
            const k = (t.in > 0 ? 'in:' : 'out:') + normPayee(t.desc);
            if (!k.slice(4))
                continue;
            if (!groups.has(k))
                groups.set(k, []);
            groups.get(k).push(t);
        }
        const out = [];
        for (const [k, list] of groups) {
            const months = new Set(list.map((t) => monthKey(t.date)));
            if (months.size < 2)
                continue;
            const amounts = list.map((t) => Math.abs(signed(t)));
            const med = median(amounts);
            if (!med)
                continue;
            const spread = median(amounts.map((a) => Math.abs(a - med))) / med;
            const days = list.map((t) => +t.date.slice(8, 10));
            out.push({
                key: k,
                dir: k.startsWith('in:') ? 'in' : 'out',
                label: list[0].desc,
                cat: list[0].cat,
                amount: med,
                day: Math.round(median(days)),
                count: list.length,
                months: months.size,
                steady: spread < 0.15,
                last: list[0].date,
            });
        }
        return out.sort((a, b) => b.amount * b.months - a.amount * a.months);
    }
    /* ----------------------------------------------------------- forecast --- */
    function forecast(horizonDays) {
        const cb = currentBalance();
        if (!cb)
            return null;
        const rec = recurring();
        const recKeys = new Set(rec.map((r) => r.key));
        const start = dOf(cb.date).getTime();
        const spanStart = Math.min(...S.tx.map((t) => dOf(t.date).getTime()));
        const historyDays = Math.max(1, Math.round((start - spanStart) / DAY) + 1);
        // discretionary = outflows that are not part of a recurring group, measured
        // over the most recent 90 days so an old archive does not dilute the rate
        const windowStart = Math.max(spanStart, start - 89 * DAY);
        const discretionary = S.tx.filter((t) => t.out > 0 && dOf(t.date).getTime() >= windowStart && !recKeys.has('out:' + normPayee(t.desc)));
        const perDay = new Map();
        for (const t of discretionary)
            perDay.set(t.date, (perDay.get(t.date) || 0) + t.out);
        const dailyValues = [];
        for (let d = windowStart; d <= start; d += DAY)
            dailyValues.push(perDay.get(iso(new Date(d))) || 0);
        const dailyBurn = dailyValues.length ? dailyValues.reduce((a, b) => a + b, 0) / dailyValues.length : 0;
        const mad = median(dailyValues.map((v) => Math.abs(v - dailyBurn))) || dailyBurn * 0.5;
        const points = [];
        let bal = cb.bal;
        const events = [];
        for (let k = 1; k <= horizonDays; k++) {
            const t = start + k * DAY;
            const d = new Date(t);
            const dom = d.getUTCDate();
            bal -= dailyBurn;
            for (const r of rec) {
                if (r.day !== dom)
                    continue;
                const delta = r.dir === 'in' ? r.amount : -r.amount;
                bal += delta;
                events.push({ t, label: r.label, amount: delta });
            }
            const band = mad * Math.sqrt(k) * 1.6;
            points.push({ t, bal, lo: bal - band, hi: bal + band });
        }
        const hasIncome = S.tx.some((t) => t.kind === 'income' && t.in > 0);
        const recIncome = rec.some((r) => r.dir === 'in');
        return { start, startBal: cb.bal, startDate: cb.date, points, dailyBurn, mad, rec, events,
            historyDays, hasIncome, recIncome };
    }
    /* =====================================================================
       Rendering
       ===================================================================== */
    function render() {
        decorate();
        fillCatFilter();
        const months = monthsPresent();
        $('#savings-directory').hidden = !directoryOpen;
        if (!S.tx.length) {
            $('#empty').hidden = directoryOpen;
            $('#main').hidden = true;
            return;
        }
        $('#empty').hidden = true;
        $('#main').hidden = directoryOpen;
        if (!S.month || !months.includes(S.month))
            S.month = months[0];
        renderMonths(months);
        renderHero(months);
        renderAttention();
        renderAgents();
        renderRecommendations();
        renderForecast();
        renderBudgets();
        renderCategories();
        renderRecurring();
        renderTx();
        renderFoot();
        $('#acct').textContent = S.accounts.length
            ? t('accountLabel', { accounts: S.accounts.join(' · ') })
            : t('subtitle');
    }
    function renderAgents() {
        const grid = $('#agent-grid');
        grid.textContent = '';
        const results = runFinancialAgents({
            transactions: S.tx, overrides: S.overrides, rules: S.rules, categories: S.cats,
        });
        const addCard = (id, titleKey, content, tone = 'info') => {
            grid.append(el('article', { class: `agent-card agent-card--${tone}`, 'data-testid': `agent-${id}` }, [
                el('header', {}, [el('span', { class: 'agent-dot', 'aria-hidden': 'true' }), el('h3', { text: t(titleKey) })]),
                el('div', { class: 'agent-body' }, content),
            ]));
        };
        const messages = (items, emptyKey) => items.length
            ? items.slice(0, 3).map((text) => el('p', { text }))
            : [el('p', { class: 'agent-clear', text: t(emptyKey) })];
        const learning = results.learning;
        const learningContent = learning
            ? [el('p', { text: t('agentLearningProposal', { match: learning.match, category: catById(learning.categoryId).name }) })]
            : [el('p', { class: 'agent-clear', text: t('agentNoLearning') })];
        if (learning) {
            learningContent.push(el('button', {
                class: 'btn sm', type: 'button', text: t('approveRule'), 'data-testid': 'approve-learning-rule',
                onclick: () => {
                    S.rules.unshift({ id: 'learned-' + Date.now(), match: learning.match, cat: learning.categoryId });
                    save();
                    render();
                    toast(t('ruleApproved'));
                },
            }));
        }
        addCard('learning', 'agentLearningTitle', learningContent, learning ? 'action' : 'quiet');
        addCard('anomalies', 'agentAnomalyTitle', messages(results.anomalies.map((item) => t('agentAnomalyResult', {
            merchant: item.merchant, percent: item.percent, latest: money(item.latest), baseline: money(item.baseline),
        })), 'agentNoAnomalies'), results.anomalies.length ? 'warning' : 'quiet');
        addCard('missing', 'agentMissingTitle', messages(results.missing.map((item) => t(item.direction === 'in' ? 'agentMissingIncomeResult' : 'agentMissingExpenseResult', { merchant: item.merchant, amount: money(item.amount), day: item.expectedDay })), 'agentNoMissing'), results.missing.length ? 'warning' : 'quiet');
        addCard('duplicates', 'agentDuplicateTitle', messages(results.duplicates.map((item) => t('agentDuplicateResult', {
            merchant: item.merchant, amount: money(item.amount), first: DDMMYY.format(dOf(item.firstDate)), second: DDMMYY.format(dOf(item.secondDate)),
        })), 'agentNoDuplicates'), results.duplicates.length ? 'critical' : 'quiet');
        addCard('subscriptions', 'agentSubscriptionTitle', messages(results.subscriptions.map((item) => {
            const base = t('agentSubscriptionResult', { merchant: item.merchant, monthly: money(item.monthly), annual: money(item.annual) });
            return item.increasePercent >= 5 ? `${base} ${t('agentSubscriptionIncrease', { percent: item.increasePercent })}` : base;
        }), 'agentNoSubscriptions'), results.subscriptions.some((item) => item.increasePercent >= 5) ? 'warning' : 'info');
        const budgetContent = results.budgetSuggestions.length
            ? results.budgetSuggestions.slice(0, 3).flatMap((item) => [
                el('p', { text: t('agentBudgetResult', { category: catById(item.categoryId).name, amount: money(item.suggested), months: item.months }) }),
                el('button', {
                    class: 'btn sm', type: 'button', text: t('applyBudget'), 'data-testid': 'apply-budget-suggestion',
                    onclick: () => { S.budgets[item.categoryId] = item.suggested; save(); render(); toast(t('budgetApplied')); },
                }),
            ])
            : [el('p', { class: 'agent-clear', text: t('agentNoBudgetSuggestions') })];
        addCard('budget', 'agentBudgetTitle', budgetContent, results.budgetSuggestions.length ? 'action' : 'quiet');
        const payday = results.payday;
        const paydayText = !payday ? t('agentPaydayNoBalance')
            : !payday.nextIncomeDate ? t('agentPaydayNoIncome', { balance: money(payday.balance) })
                : t('agentPaydayResult', {
                    balance: money(payday.balance), committed: money(payday.committed), date: DDMMYY.format(dOf(payday.nextIncomeDate)), free: money(payday.freeToSpend),
                });
        addCard('payday', 'agentPaydayTitle', [el('p', { text: paydayText })], payday && payday.freeToSpend < 0 ? 'critical' : 'info');
    }
    function renderAttention() {
        const box = $('#attention');
        box.textContent = '';
        const items = [];
        const cb = currentBalance();
        if (cb && cb.bal < 0)
            items.push({ kind: 'crit', title: t('negativeBalance'), text: t('amountAsOfDate', { amount: money(cb.bal), date: DDMMYY.format(dOf(cb.date)) }) });
        const spend = new Map(byCategory(txOfMonth(S.month)));
        for (const c of S.cats.filter((x) => x.kind === 'expense' && S.budgets[x.id] > 0)) {
            const pct = (spend.get(c.id) || 0) / S.budgets[c.id];
            if (pct > 1)
                items.push({ kind: 'crit', title: t('budgetExceeded'), text: t('categoryAmount', { category: catById(c.id).name, amount: money((spend.get(c.id) || 0) - S.budgets[c.id]) }) });
            else if (pct > .8)
                items.push({ kind: 'warn', title: t('budgetNearLimit'), text: t('categoryPercentUsed', { category: catById(c.id).name, percent: Math.round(pct * 100) }) });
        }
        const uncategorised = txOfMonth(S.month).filter((t) => t.cat === 'other').length;
        if (uncategorised)
            items.push({ kind: 'warn', title: t('transactionsNeedReview'), text: t('uncategorizedTransactions', { count: uncategorised }) });
        const fc = forecast(30);
        if (fc && fc.points.some((p) => p.bal < 0))
            items.push({ kind: 'crit', title: t('cashFlowRisk'), text: t('forecastBelowZero') });
        if (!items.length)
            items.push({ title: t('noUrgentAlerts'), text: t('dataLooksBalanced') });
        for (const item of items.slice(0, 4)) {
            box.append(el('div', { class: 'attention-item ' + (item.kind || ''), 'data-testid': 'attention-item' }, [
                el('span', { class: 'ai-dot', 'aria-hidden': 'true' }),
                el('div', {}, [el('strong', { text: item.title }), el('span', { text: item.text })]),
            ]));
        }
    }
    function renderRecommendations() {
        const box = $('#recommendation-list');
        const note = $('#rec-screen-note');
        box.textContent = '';
        const recommendations = [];
        const monthTransactions = txOfMonth(S.month);
        const spend = new Map(byCategory(monthTransactions));
        const accountLabel = S.accounts.length ? t('accountLabel', { accounts: S.accounts[0] }) : t('customer');
        const balance = currentBalance();
        if (balance?.bal != null && balance.bal < 0) {
            recommendations.push({ level: 'critical', title: t('recNegativeTitle'), detail: t('recNegativeDetail', { account: accountLabel, amount: money(balance.bal) }), impact: t('recNegativeImpact'), action: t('reviewCashFlow'), target: '#fc-h' });
        }
        for (const category of S.cats.filter((item) => item.kind === 'expense' && S.budgets[item.id] > 0)) {
            const used = spend.get(category.id) || 0;
            const ratio = used / S.budgets[category.id];
            const categoryName = catById(category.id).name;
            if (ratio > 1)
                recommendations.push({ level: 'critical', title: t('recReduceCategoryTitle', { category: categoryName }), detail: t('recBudgetExceededDetail', { amount: money(used - S.budgets[category.id]) }), impact: t('recBudgetExceededImpact', { amount: money(used - S.budgets[category.id]) }), action: t('openBudget'), target: '#bd-h' });
            else if (ratio > .8)
                recommendations.push({ level: 'warning', title: t('recWatchCategoryTitle', { category: categoryName }), detail: t('recBudgetUsedDetail', { percent: Math.round(ratio * 100) }), impact: t('recBudgetRemainingImpact', { amount: money(S.budgets[category.id] - used) }), action: t('openBudget'), target: '#bd-h' });
        }
        const uncategorised = monthTransactions.filter((transaction) => transaction.cat === 'other').length;
        if (uncategorised)
            recommendations.push({ level: 'warning', title: t('recClassifyTitle'), detail: t('recClassifyDetail', { count: uncategorised }), impact: t('recClassifyImpact'), action: t('filterTransactions'), target: '#tx-h' });
        const recurringCharges = recurring().filter((item) => item.dir === 'out');
        if (recurringCharges.length) {
            const largest = recurringCharges[0];
            recommendations.push({ level: 'info', title: t('recReviewRecurringTitle'), detail: t('recReviewRecurringDetail', { merchant: largest.label, amount: money(largest.amount) }), impact: t('recReviewRecurringImpact'), action: t('reviewCharges'), target: '#rc-h' });
        }
        if (!recommendations.length)
            recommendations.push({ level: 'info', title: t('recContinueTitle'), detail: t('recContinueDetail'), impact: t('recContinueImpact'), action: t('backToDashboard'), target: '#hero-h' });
        note.textContent = t('recommendationsSummary', { count: recommendations.length, account: accountLabel, month: monthLabel(S.month) });
        recommendations.slice(0, 8).forEach((recommendation, index) => {
            const button = el('button', { class: 'btn sm', type: 'button', text: recommendation.action, 'data-testid': 'recommendation-action' });
            button.addEventListener('click', () => {
                showDashboard();
                const target = $(recommendation.target);
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                if (recommendation.target === '#tx-h')
                    $('#f-cat').value = 'other';
                if (recommendation.target === '#tx-h')
                    renderTx();
            });
            box.append(el('article', { class: 'recommendation ' + recommendation.level, 'data-testid': 'recommendation-card' }, [
                el('div', { class: 'priority', text: String(index + 1), 'aria-label': t('priorityNumber', { number: index + 1 }) }),
                el('div', {}, [el('h3', { text: recommendation.title }), el('p', { text: recommendation.detail }), el('div', { class: 'impact', text: recommendation.impact })]),
                button,
            ]));
        });
    }
    function showRecommendations() {
        if (!S.tx.length)
            return;
        directoryOpen = false;
        if (window.location.hash)
            history.replaceState(null, '', window.location.pathname + window.location.search);
        $('#savings-directory').hidden = true;
        $('#main').hidden = false;
        $('#recommendations').hidden = false;
        $$('#main > *').forEach((child) => { if (child.id !== 'months' && child.id !== 'recommendations')
            child.hidden = true; });
        $('#btn-recommendations').setAttribute('aria-pressed', 'true');
        $('#recommendations').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function showDashboard() {
        directoryOpen = false;
        if (window.location.hash)
            history.replaceState(null, '', window.location.pathname + window.location.search);
        $('#savings-directory').hidden = true;
        $('#recommendations').hidden = true;
        $('#main').hidden = !S.tx.length;
        $('#empty').hidden = Boolean(S.tx.length);
        $$('#main > *').forEach((child) => { if (child.id !== 'months' && child.id !== 'recommendations')
            child.hidden = false; });
        $('#btn-recommendations').setAttribute('aria-pressed', 'false');
        $('#btn-savings').setAttribute('aria-pressed', 'false');
    }
    function showSavingsDirectory() {
        directoryOpen = true;
        history.replaceState(null, '', '#savings-directory');
        $('#empty').hidden = true;
        $('#main').hidden = true;
        $('#savings-directory').hidden = false;
        $('#btn-savings').setAttribute('aria-pressed', 'true');
        $('#btn-recommendations').setAttribute('aria-pressed', 'false');
        $('#savings-directory').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function renderMonths(months) {
        const nav = $('#months');
        nav.textContent = '';
        for (const mk of months) {
            nav.append(el('button', {
                class: 'mchip', type: 'button', 'data-testid': 'month-chip',
                'aria-pressed': mk === S.month ? 'true' : 'false',
                text: monthLabel(mk),
                onclick: () => { S.month = mk; render(); },
            }));
        }
    }
    /* ------------------------------------------------------------- hero ----- */
    function renderHero(months) {
        const list = txOfMonth(S.month);
        const tot = totals(list);
        const cb = currentBalance();
        $('#t-bal').textContent = cb ? money(cb.bal) : '—';
        $('#t-bal').className = 'val num' + (cb && cb.bal < 0 ? ' neg' : '');
        $('#t-bal-sub').textContent = cb ? t('asOfDate', { date: DDMMYY.format(dOf(cb.date)) }) : '';
        $('#t-in').textContent = money(tot.in);
        $('#t-out').textContent = money(tot.out);
        $('#t-net').textContent = moneyS(tot.net);
        $('#t-net').className = 'val sm num ' + (tot.net >= 0 ? 'pos' : 'neg');
        const idx = months.indexOf(S.month);
        const prev = idx >= 0 && idx + 1 < months.length ? totals(txOfMonth(months[idx + 1])) : null;
        const delta = (cur, was) => {
            if (!prev || !was)
                return '';
            const pct = Math.round(((cur - was) / was) * 100);
            if (!isFinite(pct) || pct === 0)
                return t('sameAsPreviousMonth');
            return t('percentFromPreviousMonth', { arrow: pct > 0 ? '▲' : '▼', percent: Math.abs(pct) });
        };
        $('#t-in-sub').textContent = delta(tot.in, prev && prev.in);
        $('#t-out-sub').textContent = delta(tot.out, prev && prev.out);
        $('#t-net-sub').textContent = tot.moved
            ? t('unaccountedTransfers', { amount: money(tot.moved) })
            : t('transactionCount', { count: list.length });
        drawWaterline(months);
    }
    /* Income above the line, spending below it — one shared ₪ scale, so the
       month whose bar hangs lower than it rises is the month that ate savings. */
    function drawWaterline(months) {
        const svg = $('#wl');
        const tip = $('#wl-tip');
        svg.textContent = '';
        const narrow = (svg.parentElement.clientWidth || 900) < 560;
        const show = months.slice(0, narrow ? 6 : 12).reverse(); // oldest → newest
        const data = show.map((mk) => ({ mk, ...totals(txOfMonth(mk)) }));
        const max = Math.max(1, ...data.map((d) => Math.max(d.in, d.out)));
        const W = narrow ? 420 : 900, H = narrow ? 250 : 210;
        const padT = 16, padB = 26, padR = narrow ? 50 : 62, padL = 8;
        const plotH = H - padT - padB;
        const zero = padT + plotH / 2;
        const plotW = W - padL - padR;
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('height', String(H));
        const y = (v) => zero - (v / max) * (plotH / 2 - 6);
        // gridlines + right-hand value axis
        for (const frac of [-1, -0.5, 0, 0.5, 1]) {
            const yy = y(frac * max);
            svg.append(s('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, class: frac === 0 ? 'axisline' : 'gridline' }));
            svg.append(Object.assign(s('text', {
                x: W - padR + 8, y: yy + 4, class: 'tick', 'text-anchor': 'start',
            }), { textContent: frac === 0 ? '0' : NUM0.format(Math.abs(frac * max)) }));
        }
        const band = plotW / show.length;
        const bw = Math.min(30, band * 0.36);
        data.forEach((d, i) => {
            const cx = padL + band * (i + 0.5);
            const isSel = d.mk === S.month;
            const mk = s('g', { style: 'cursor:pointer' });
            // 2px surface gap between the two fills is achieved by insetting from zero
            if (d.in > 0)
                mk.append(s('rect', {
                    x: cx - bw - 1, y: y(d.in), width: bw, height: Math.max(1, zero - 1 - y(d.in)),
                    rx: 4, fill: 'var(--good)', opacity: isSel ? 1 : 0.6,
                }));
            if (d.out > 0)
                mk.append(s('rect', {
                    x: cx + 1, y: zero + 1, width: bw, height: Math.max(1, y(-d.out) - zero - 1),
                    rx: 4, fill: 'var(--crit)', opacity: isSel ? 1 : 0.6,
                }));
            mk.append(s('rect', { x: cx - band / 2, y: padT, width: band, height: plotH, fill: 'transparent' }));
            mk.addEventListener('pointerenter', () => {
                renderTooltip(tip, monthLabel(d.mk), [
                    [t('incomeShort'), money(d.in)],
                    [t('expensesShort'), money(d.out)],
                    [t('netShort'), moneyS(d.net)],
                ]);
                tip.classList.add('on');
                const r = svg.getBoundingClientRect();
                const px = (cx / W) * r.width;
                tip.style.right = 'auto';
                tip.style.left = clamp(px - 72, 4, Math.max(4, r.width - 160)) + 'px';
                tip.style.top = '6px';
            });
            mk.addEventListener('pointerleave', () => tip.classList.remove('on'));
            mk.addEventListener('click', () => { S.month = d.mk; render(); });
            svg.append(mk);
            svg.append(Object.assign(s('text', {
                x: cx, y: H - 8, class: 'tick', 'text-anchor': 'middle',
                style: isSel ? 'fill:var(--ink);font-weight:700' : null,
            }), { textContent: MONTH_SHORT.format(new Date(d.mk + '-01T00:00:00Z')) }));
        });
        $('#wl-note').textContent = show.length > 1
            ? t('monthsInHistory', { count: show.length })
            : t('oneMonthHistory');
    }
    /* --------------------------------------------------------- forecast ----- */
    function renderForecast() {
        const horizon = +$('#fc-horizon').value;
        const f = forecast(horizon);
        const svg = $('#fc');
        const tip = $('#fc-tip');
        svg.textContent = '';
        if (!f) {
            $('#fc-note').textContent = t('forecastNoBalance');
            return;
        }
        const hist = balanceSeries();
        const histShown = hist.slice(-Math.min(hist.length, 90));
        const all = [...histShown.map((p) => ({ t: p.t, v: p.bal })), ...f.points.map((p) => ({ t: p.t, v: p.bal }))];
        const lo = Math.min(0, ...all.map((p) => p.v), ...f.points.map((p) => p.lo));
        const hi = Math.max(...all.map((p) => p.v), ...f.points.map((p) => p.hi));
        const t0 = all[0].t, t1 = all[all.length - 1].t;
        const narrow = (svg.parentElement.clientWidth || 900) < 560;
        const W = narrow ? 420 : 900, H = narrow ? 280 : 250;
        const padT = 14, padB = 26, padR = narrow ? 52 : 64, padL = 8;
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('height', String(H));
        const X = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
        const Y = (v) => padT + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - padT - padB);
        for (let i = 0; i <= 4; i++) {
            const v = lo + ((hi - lo) * i) / 4;
            const yy = Y(v);
            svg.append(s('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, class: v === 0 ? 'axisline' : 'gridline' }));
            svg.append(Object.assign(s('text', { x: W - padR + 8, y: yy + 4, class: 'tick', 'text-anchor': 'start' }), { textContent: NUM0.format(Math.round(v)) }));
        }
        if (lo < 0 && hi > 0) {
            svg.append(s('line', { x1: padL, x2: W - padR, y1: Y(0), y2: Y(0), stroke: 'var(--crit)', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: .55 }));
        }
        // uncertainty band
        if (f.points.length) {
            const up = f.points.map((p) => `${X(p.t)},${Y(p.hi)}`).join(' ');
            const dn = [...f.points].reverse().map((p) => `${X(p.t)},${Y(p.lo)}`).join(' ');
            svg.append(s('polygon', {
                points: `${X(f.start)},${Y(f.startBal)} ${up} ${dn}`,
                fill: f.hasIncome && f.recIncome ? 'var(--accent)' : 'var(--muted)', opacity: .12,
            }));
        }
        // history
        if (histShown.length > 1) {
            svg.append(s('polyline', {
                points: histShown.map((p) => `${X(p.t)},${Y(p.bal)}`).join(' '),
                fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-linejoin': 'round',
            }));
        }
        // projection — muted when there is no income to project against
        const trust = f.hasIncome && f.recIncome;
        svg.append(s('polyline', {
            points: [`${X(f.start)},${Y(f.startBal)}`, ...f.points.map((p) => `${X(p.t)},${Y(p.bal)}`)].join(' '),
            fill: 'none', stroke: trust ? 'var(--accent)' : 'var(--muted)', 'stroke-width': 2,
            'stroke-dasharray': '5 4', opacity: trust ? .85 : .55,
        }));
        // the boundary between what happened and what is merely projected
        svg.append(s('line', {
            x1: X(f.start), x2: X(f.start), y1: padT, y2: H - padB,
            stroke: 'var(--line-2)', 'stroke-width': 1,
        }));
        if (!narrow) {
            const mark = s('text', { x: X(f.start) + 8, y: padT + 11, class: 'tick', 'text-anchor': 'start' });
            mark.textContent = t('forecastStartsHere');
            svg.append(mark);
        }
        svg.append(s('circle', { cx: X(f.start), cy: Y(f.startBal), r: 4.5, fill: 'var(--accent)', stroke: 'var(--surface)', 'stroke-width': 2 }));
        // end label, direct
        const last = f.points[f.points.length - 1];
        const endTxt = s('text', { x: X(last.t) - 6, y: Y(last.bal) - 10, class: 'tick', 'text-anchor': 'end', style: 'fill:var(--ink);font-weight:700;font-size:12px' });
        endTxt.textContent = money(last.bal);
        svg.append(endTxt);
        // date ticks
        const ticks = narrow ? 3 : 5;
        for (let i = 0; i <= ticks; i++) {
            const t = t0 + ((t1 - t0) * i) / ticks;
            svg.append(Object.assign(s('text', { x: X(t), y: H - 8, class: 'tick', 'text-anchor': 'middle' }), { textContent: DDMM.format(new Date(t)) }));
        }
        // crosshair + tooltip
        const cross = s('line', { y1: padT, y2: H - padB, class: 'axisline', opacity: 0, 'stroke-dasharray': '2 3' });
        svg.append(cross);
        const hitAll = [...histShown.map((p) => ({ t: p.t, v: p.bal, kind: 'hist' })),
            ...f.points.map((p) => ({ t: p.t, v: p.bal, lo: p.lo, hi: p.hi, kind: 'fc' }))];
        const hit = s('rect', { x: padL, y: padT, width: W - padL - padR, height: H - padT - padB, fill: 'transparent' });
        hit.addEventListener('pointermove', (ev) => {
            const r = svg.getBoundingClientRect();
            const vx = ((ev.clientX - r.left) / r.width) * W; // client px -> viewBox x
            const tt = t0 + ((vx - padL) / (W - padL - padR)) * (t1 - t0);
            let best = hitAll[0], bd = Infinity;
            for (const p of hitAll) {
                const d = Math.abs(p.t - tt);
                if (d < bd) {
                    bd = d;
                    best = p;
                }
            }
            cross.setAttribute('x1', String(X(best.t)));
            cross.setAttribute('x2', String(X(best.t)));
            cross.setAttribute('opacity', String(.8));
            const ev2 = f.events.filter((e) => e.t === best.t);
            const rows = [
                [best.kind === 'fc' ? t('expectedBalance') : t('balance'), money(best.v)],
            ];
            if (best.kind === 'fc' && best.hi - best.lo > 1)
                rows.push([t('range'), `${money(best.lo)}–${money(best.hi)}`]);
            for (const event of ev2)
                rows.push([event.label.slice(0, 22), moneyS(event.amount)]);
            renderTooltip(tip, DDMMYY.format(new Date(best.t)), rows);
            tip.classList.add('on');
            tip.style.right = 'auto';
            tip.style.left = clamp((X(best.t) / W) * r.width - 80, 4, Math.max(4, r.width - 178)) + 'px';
            tip.style.top = '4px';
        });
        hit.addEventListener('pointerleave', () => { tip.classList.remove('on'); cross.setAttribute('opacity', String(0)); });
        svg.append(hit);
        const nRec = f.rec.length;
        const thin = f.historyDays < 45;
        const blind = !f.hasIncome || !f.recIncome;
        $('#fc-note').textContent =
            t(f.dailyBurn > 0.005 ? 'forecastBaseWithDaily' : 'forecastBaseWithoutDaily', {
                balance: money(f.startBal), date: DDMMYY.format(dOf(f.startDate)), daily: money2(f.dailyBurn),
            }) +
                (nRec ? ' ' + t('forecastRecurringSuffix', { count: nRec }) : '') +
                ' ' + t('forecastUncertainty') +
                (thin ? ' ' + t('forecastThinHistory', { days: f.historyDays }) : '') +
                (blind ? ' ' + t(f.hasIncome ? 'forecastNoRecurringIncomeWarning' : 'forecastNoIncomeWarning') : '');
    }
    /* ---------------------------------------------------------- budgets ----- */
    function renderBudgets() {
        const box = $('#bd-list');
        box.textContent = '';
        const list = txOfMonth(S.month);
        const spend = new Map(byCategory(list));
        const tracked = S.cats.filter((c) => c.kind === 'expense' && S.budgets[c.id] > 0);
        if (!tracked.length) {
            $('#bd-note').textContent = t('budgetsNotConfiguredNote');
            box.append(el('div', { class: 'empty-row', text: t('noBudgetLimits') }));
            return;
        }
        const totalCap = tracked.reduce((a, c) => a + S.budgets[c.id], 0);
        const totalSpent = tracked.reduce((a, c) => a + (spend.get(c.id) || 0), 0);
        $('#bd-note').textContent = t('budgetTrackingSummary', { spent: money(totalSpent), cap: money(totalCap), month: monthLabel(S.month) });
        for (const c of tracked) {
            const cap = S.budgets[c.id];
            const used = spend.get(c.id) || 0;
            const pct = used / cap;
            const state = pct > 1 ? 'over' : pct > 0.8 ? 'warn' : 'ok';
            const label = pct > 1 ? t('overByAmount', { amount: money(used - cap) }) : t('remainingAmount', { amount: money(cap - used) });
            box.append(el('div', { class: 'catrow', 'data-testid': 'budget-row' }, [
                el('div', { class: 'top' }, [
                    el('span', { class: 'dot', style: `background:${catColor(S.cats, c.id)}` }),
                    el('span', { class: 'nm', text: catById(c.id).name }),
                    el('span', { class: 'badge ' + state, text: label }),
                    el('span', { class: 'amt num', text: money(used) + ' / ' + money(cap) }),
                ]),
                el('div', { class: 'track' }, [
                    el('div', {
                        class: 'fill',
                        style: `width:${clamp(pct, 0, 1) * 100}%;background:${state === 'over' ? 'var(--crit)' : catColor(S.cats, c.id)}`,
                    }),
                    el('div', { class: 'cap', style: 'inset-inline-start:100%' }),
                ]),
            ]));
        }
    }
    /* -------------------------------------------------------- categories ---- */
    function renderCategories() {
        const list = txOfMonth(S.month);
        const rows = byCategory(list);
        const box = $('#cat-list');
        const tbl = $('#cat-table');
        box.textContent = '';
        tbl.textContent = '';
        const total = rows.reduce((a, [, v]) => a + v, 0);
        if (!rows.length) {
            $('#cat-note').textContent = t('noExpensesThisMonth');
            box.append(el('div', { class: 'empty-row', text: t('noData') }));
            return;
        }
        const top = rows[0];
        $('#cat-note').textContent = t('categorySpendingSummary', {
            total: money(total), month: monthLabel(S.month), category: catById(top[0]).name,
            percent: Math.round((top[1] / total) * 100),
        });
        const max = rows[0][1];
        for (const [cid, v] of rows) {
            box.append(el('div', { class: 'catrow', 'data-testid': 'category-row' }, [
                el('div', { class: 'top' }, [
                    el('span', { class: 'dot', style: `background:${catColor(S.cats, cid)}` }),
                    el('span', { class: 'nm', text: catById(cid).name }),
                    el('span', { class: 'pct num', text: Math.round((v / total) * 100) + '%' }),
                    el('span', { class: 'amt num', text: money(v) }),
                ]),
                el('div', { class: 'track' }, [
                    el('div', { class: 'fill', style: `width:${(v / max) * 100}%;background:${catColor(S.cats, cid)}` }),
                ]),
            ]));
        }
        const table = el('table');
        table.append(el('thead', {}, el('tr', {}, [
            el('th', { text: t('category') }), el('th', { text: t('amount') }),
            el('th', { text: t('shareOfSpending') }), el('th', { text: t('transactions') }),
        ])));
        const tb = el('tbody');
        for (const [cid, v] of rows) {
            tb.append(el('tr', { 'data-testid': 'category-table-row' }, [
                el('td', { text: catById(cid).name }),
                el('td', { class: 'n', text: money2(v) }),
                el('td', { class: 'n', text: Math.round((v / total) * 100) + '%' }),
                el('td', { class: 'n', text: list.filter((x) => x.cat === cid && x.out > 0).length }),
            ]));
        }
        table.append(tb);
        tbl.append(table);
    }
    /* --------------------------------------------------------- recurring ---- */
    function renderRecurring() {
        const rec = recurring();
        const box = $('#rc-list');
        box.textContent = '';
        if (!rec.length) {
            $('#rc-note').textContent = t('recurringNoneNote');
            box.append(el('div', { class: 'empty-row', text: t('noRecurringCharges') }));
            return;
        }
        const monthlyOut = rec.filter((r) => r.dir === 'out').reduce((a, r) => a + r.amount, 0);
        const monthlyIn = rec.filter((r) => r.dir === 'in').reduce((a, r) => a + r.amount, 0);
        $('#rc-note').textContent = t('recurringSummary', { count: rec.length, out: money(monthlyOut), in: money(monthlyIn) });
        const table = el('table');
        table.append(el('thead', {}, el('tr', {}, [
            el('th', { text: t('merchant') }), el('th', { text: t('category') }), el('th', { text: t('typicalAmount') }),
            el('th', { text: t('dayOfMonth') }), el('th', { text: t('occurrences') }), el('th', { text: t('stability') }),
        ])));
        const tb = el('tbody');
        for (const r of rec.slice(0, 14)) {
            tb.append(el('tr', { 'data-testid': 'recurring-row' }, [
                el('td', { class: 'desc', text: r.label }),
                el('td', {}, [el('span', { class: 'dot', style: `background:${catColor(S.cats, r.cat)}` }), catById(r.cat).name]),
                el('td', { class: 'n', text: money2S(r.dir === 'in' ? r.amount : -r.amount) }),
                el('td', { class: 'n', text: r.day }),
                el('td', { class: 'n', text: t('occurrenceSummary', { count: r.count, months: r.months }) }),
                el('td', {}, el('span', { class: 'badge ' + (r.steady ? 'ok' : 'warn'), text: t(r.steady ? 'steady' : 'variable') })),
            ]));
        }
        table.append(tb);
        box.append(table);
    }
    /* -------------------------------------------------------- transactions -- */
    function renderTx() {
        const q = clean($('#q').value).toLowerCase();
        const fc = $('#f-cat').value, fd = $('#f-dir').value, fs = $('#f-scope').value;
        let list = fs === 'all' ? S.tx : txOfMonth(S.month);
        if (fc)
            list = list.filter((t) => t.cat === fc);
        if (fd === 'out')
            list = list.filter((t) => t.out > 0);
        if (fd === 'in')
            list = list.filter((t) => t.in > 0);
        if (q)
            list = list.filter((t) => (t.desc + ' ' + t.ref).toLowerCase().includes(q));
        const body = $('#tx-body');
        body.textContent = '';
        $('#tx-count').textContent = t('transactionTotals', {
            count: list.length,
            out: money(list.reduce((a, transaction) => a + transaction.out, 0)),
            in: money(list.reduce((a, transaction) => a + transaction.in, 0)),
        });
        if (!list.length) {
            body.append(el('tr', {}, el('td', { colspan: 6, class: 'empty-row', text: t('noMatchingTransactions') })));
            return;
        }
        for (const transaction of list.slice(0, 400)) {
            const sel = el('select', { class: 'catsel', 'aria-label': t('categoryForTransaction', { description: transaction.desc }), 'data-testid': 'transaction-category-select' });
            for (const c of S.cats)
                sel.append(el('option', { value: c.id, text: catById(c.id).name, selected: c.id === transaction.cat }));
            sel.addEventListener('change', () => {
                S.overrides[transaction.id] = sel.value;
                save();
                render();
                toast(t('categoryUpdatedToast'));
            });
            const amt = money2S(transaction.in > 0 ? transaction.in : -transaction.out);
            body.append(el('tr', { 'data-testid': 'transaction-row' }, [
                el('td', { class: 'n', text: DDMMYY.format(dOf(transaction.date)) }),
                el('td', { class: 'desc', text: transaction.desc + (transaction.pending ? ' · ' + t('pending') : '') }),
                el('td', { class: 'catcell' }, [el('span', { class: 'dot', style: `background:${catColor(S.cats, transaction.cat)}` }), sel]),
                el('td', { class: 'n ' + (transaction.in > 0 ? 'pos' : 'neg'), text: amt }),
                el('td', { class: 'n', text: transaction.bal != null ? money2(transaction.bal) : '', 'data-testid': 'transaction-balance' }),
                el('td', { class: 'n', style: 'color:var(--muted);font-size:12.5px', text: transaction.ref }),
            ]));
        }
        if (list.length > 400) {
            body.append(el('tr', {}, el('td', { colspan: 6, class: 'empty-row', text: t('showingFirstTransactions', { shown: 400, total: list.length }) })));
        }
    }
    function renderFoot() {
        const dates = S.tx.map((t) => t.date).sort();
        const srcs = new Set(S.tx.map((t) => t.src));
        $('#foot-note').textContent = t('historySummary', {
            transactions: S.tx.length, reports: srcs.size,
            from: DDMMYY.format(dOf(dates[0])), to: DDMMYY.format(dOf(dates[dates.length - 1])),
        });
    }
    /* =====================================================================
       Drawer: budgets, rules, categories, data
       ===================================================================== */
    function renderDrawer() {
        const b = $('#dr-budgets');
        b.textContent = '';
        for (const c of S.cats.filter((c) => c.kind === 'expense')) {
            const inp = el('input', {
                type: 'number', min: '0', step: '50', inputmode: 'numeric',
                value: S.budgets[c.id] || '', placeholder: t('none'),
                'aria-label': t('monthlyLimitForCategory', { category: catById(c.id).name }), 'data-testid': 'budget-limit-input',
            });
            inp.addEventListener('change', () => {
                const v = parseFloat(inp.value);
                if (v > 0)
                    S.budgets[c.id] = v;
                else
                    delete S.budgets[c.id];
                save();
                render();
            });
            b.append(el('div', { class: 'budrow', 'data-testid': 'settings-budget-row' }, [
                el('span', { class: 'nm' }, [el('span', { class: 'dot', style: `background:${catColor(S.cats, c.id)}` }), catById(c.id).name]),
                inp, el('span', { style: 'color:var(--muted);font-size:13px', text: t('ilsPerMonth') }),
            ]));
        }
        const r = $('#dr-rules');
        r.textContent = '';
        S.rules.forEach((rule, i) => {
            const m = el('input', { type: 'text', value: rule.match, 'aria-label': t('matchingText'), 'data-testid': 'rule-match-input' });
            m.addEventListener('change', () => { S.rules[i].match = clean(m.value); save(); render(); });
            const sel = el('select', { 'aria-label': t('category'), 'data-testid': 'rule-category-select' });
            for (const c of S.cats)
                sel.append(el('option', { value: c.id, text: catById(c.id).name, selected: c.id === rule.cat }));
            sel.addEventListener('change', () => { S.rules[i].cat = sel.value; save(); render(); });
            r.append(el('div', { class: 'rulerow', 'data-testid': 'settings-rule-row' }, [
                m, el('span', { style: 'color:var(--muted)', text: '←' }), sel,
                el('button', {
                    class: 'x', 'aria-label': t('deleteRule'), text: '✕', 'data-testid': 'delete-rule-button',
                    onclick: () => { S.rules.splice(i, 1); save(); renderDrawer(); render(); },
                }),
            ]));
        });
        const cbox = $('#dr-cats');
        cbox.textContent = '';
        S.cats.forEach((c, i) => {
            const nm = el('input', { type: 'text', value: catById(c.id).name, 'aria-label': t('categoryName'), 'data-testid': 'category-name-input' });
            nm.addEventListener('change', () => { S.cats[i].name = clean(nm.value) || c.id; save(); renderDrawer(); render(); });
            const kind = el('select', { 'aria-label': t('type'), 'data-testid': 'category-type-select' });
            for (const [v, labelKey] of [['expense', 'expenseSingular'], ['income', 'incomeSingular'], ['neutral', 'transfer']])
                kind.append(el('option', { value: v, text: t(labelKey), selected: c.kind === v }));
            kind.addEventListener('change', () => { S.cats[i].kind = kind.value; save(); renderDrawer(); render(); });
            cbox.append(el('div', { class: 'rulerow', 'data-testid': 'settings-category-row' }, [
                el('span', { class: 'dot', style: `background:${catColor(S.cats, c.id)};margin-inline-end:2px` }),
                nm, kind,
                c.id === 'other' || c.id === 'income' ? el('span', { style: 'width:29px' }) : el('button', {
                    class: 'x', 'aria-label': t('deleteCategory'), text: '✕', 'data-testid': 'delete-category-button',
                    onclick: () => {
                        for (const k in S.overrides)
                            if (S.overrides[k] === c.id)
                                delete S.overrides[k];
                        S.rules = S.rules.filter((x) => x.cat !== c.id);
                        delete S.budgets[c.id];
                        S.cats.splice(i, 1);
                        save();
                        renderDrawer();
                        render();
                    },
                }),
            ]));
        });
        const dates = S.tx.map((t) => t.date).sort();
        $('#dr-stats').textContent = S.tx.length
            ? t('storedDataSummary', {
                transactions: S.tx.length, months: new Set(S.tx.map((transaction) => monthKey(transaction.date))).size,
                overrides: Object.keys(S.overrides).length,
                range: dates.length ? DDMMYY.format(dOf(dates[0])) + ' – ' + DDMMYY.format(dOf(dates[dates.length - 1])) : '',
            })
            : t('noStoredData');
    }
    function prepareManualForm() {
        const cat = $('#manual-cat');
        const current = cat.value;
        cat.textContent = '';
        for (const c of S.cats)
            cat.append(el('option', { value: c.id, text: catById(c.id).name, selected: c.id === current || (!current && c.id === 'other') }));
        if (!$('#manual-date').value)
            $('#manual-date').value = S.month ? S.month + '-01' : iso(new Date());
    }
    function openDrawer() { renderDrawer(); prepareManualForm(); $('#drawer').classList.add('on'); $('#scrim').classList.add('on'); $('#dr-close').focus(); }
    function closeDrawer() { $('#drawer').classList.remove('on'); $('#scrim').classList.remove('on'); }
    /* ===================================================================== */
    /* backup                                                                */
    async function exportBackup() {
        const data = JSON.stringify({
            app: 'mazan-habait', version: 1, savedAt: new Date().toISOString(),
            tx: S.tx, overrides: S.overrides, rules: S.rules, cats: S.cats,
            budgets: S.budgets, accounts: S.accounts,
        }, null, 2);
        const name = 'mazan-habait-' + iso(new Date()) + '.json';
        let dl = null;
        const browserWindow = window;
        try {
            dl = browserWindow.claude ? await browserWindow.claude.use('downloads') : null;
        }
        catch (e) {
            dl = null;
        }
        if (dl) {
            try {
                await dl.save({ filename: name, data });
                toast(t('backupSaved'));
                return;
            }
            catch (err) {
                if (err && err.code === 'declined') {
                    toast(t('backupCancelled'));
                    return;
                }
            }
        }
        try {
            await navigator.clipboard.writeText(data);
            toast(t('backupCopied'));
        }
        catch (e) {
            toast(t('backupExportUnavailable'));
        }
    }
    function importBackup(file) {
        const fr = new FileReader();
        fr.onload = () => {
            try {
                if (typeof fr.result !== 'string')
                    throw new Error('bad');
                const p = JSON.parse(fr.result);
                if (!p || !Array.isArray(p.tx))
                    throw new Error('bad');
                S.tx = p.tx;
                S.overrides = p.overrides || {};
                S.rules = p.rules || DEFAULT_RULES;
                S.cats = p.cats || DEFAULT_CATS;
                S.budgets = p.budgets || {};
                S.accounts = p.accounts || [];
                S.month = null;
                save();
                renderDrawer();
                render();
                toast(t('backupLoadedCount', { count: S.tx.length }));
            }
            catch (e) {
                toast(t('invalidBackup'));
            }
        };
        fr.readAsText(file);
    }
    /* ---------------------------------------------------------- file load -- */
    async function handleFiles(fileList, source = 'bank') {
        const files = [...fileList];
        if (!files.length)
            return;
        let added = 0, dup = 0, bad = 0;
        for (const file of files) {
            try {
                const buf = await file.arrayBuffer();
                const wb = await readWorkbook(buf, file.name);
                const cardImporter = creditCardImporter;
                const imported = source === 'card' && cardImporter
                    ? { rows: cardImporter.import(wb, file.name), account: null }
                    : ingest(wb, file.name, source);
                const { rows, account } = imported;
                if (!rows.length) {
                    bad++;
                    continue;
                }
                if (account && !S.accounts.includes(account))
                    S.accounts.push(account);
                const have = new Set(S.tx.map((t) => t.id));
                for (const t of rows) {
                    if (have.has(t.id)) {
                        dup++;
                        continue;
                    }
                    have.add(t.id);
                    S.tx.push(t);
                    added++;
                }
            }
            catch (e) {
                bad++;
            }
        }
        save();
        trackMarketingEvent('report_import_completed', { source, added, duplicates: dup, failed: bad });
        S.month = null;
        render();
        const parts = [];
        if (added)
            parts.push(t('transactionsAdded', { count: added }));
        if (dup)
            parts.push(t('transactionsDuplicated', { count: dup }));
        if (bad)
            parts.push(t('filesUnreadable', { count: bad }));
        toast(parts.join(' · ') || t('noTransactionsInFile'));
    }
    /* ---------------------------------------------------------------- wire -- */
    function wire() {
        $('#file').addEventListener('change', (e) => { const input = e.currentTarget; if (input.files)
            handleFiles(input.files); input.value = ''; });
        $('#card-file').addEventListener('change', (e) => { const input = e.currentTarget; if (input.files)
            handleFiles(input.files, 'card'); input.value = ''; });
        const drop = $('#drop');
        const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
        ['dragenter', 'dragover'].forEach((n) => document.addEventListener(n, (e) => {
            stop(e);
            if (drop)
                drop.classList.add('over');
        }));
        ['dragleave', 'drop'].forEach((n) => document.addEventListener(n, (e) => {
            stop(e);
            if (drop)
                drop.classList.remove('over');
        }));
        document.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length)
            handleFiles(e.dataTransfer.files); });
        $('#btn-set').addEventListener('click', openDrawer);
        $('#btn-bud').addEventListener('click', openDrawer);
        $('#btn-recommendations').addEventListener('click', showRecommendations);
        $('#btn-dashboard').addEventListener('click', showDashboard);
        $('#btn-savings').addEventListener('click', showSavingsDirectory);
        $('#btn-directory-back').addEventListener('click', showDashboard);
        const openMarketingUpload = (placement) => {
            trackMarketingEvent('marketing_primary_cta_clicked', { locale, placement });
            document.querySelector('#file').click();
        };
        $('#marketing-upload').addEventListener('click', () => openMarketingUpload('hero'));
        $('#marketing-upload-final').addEventListener('click', () => openMarketingUpload('final'));
        $('#marketing-how').addEventListener('click', () => {
            trackMarketingEvent('marketing_how_it_works_clicked', { locale });
            $('#marketing-how-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        $('#locale-select').addEventListener('change', (event) => {
            const nextLocale = event.currentTarget.value;
            if (!isSupportedLocale(nextLocale) || nextLocale === locale)
                return;
            locale = nextLocale;
            localStorage.setItem('mazan-habait/locale', locale);
            // Reload from the canonical source strings so translated dynamic content
            // is never translated on top of a previously selected language.
            window.location.reload();
        });
        $('#dr-close').addEventListener('click', closeDrawer);
        $('#scrim').addEventListener('click', closeDrawer);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape')
            closeDrawer(); });
        $('#btn-backup').addEventListener('click', exportBackup);
        $('#dr-export').addEventListener('click', exportBackup);
        $('#dr-import').addEventListener('change', (e) => { const input = e.currentTarget; if (input.files?.[0])
            importBackup(input.files[0]); input.value = ''; });
        $('#manual-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const date = $('#manual-date').value;
            const desc = clean($('#manual-desc').value);
            const amount = Number($('#manual-amount').value);
            if (!date || !desc || !isFinite(amount) || amount <= 0)
                return;
            const direction = $('#manual-dir').value;
            const transaction = { date, vdate: date, ref: '', desc, out: direction === 'out' ? amount : 0, in: direction === 'in' ? amount : 0, bal: null, pending: false, src: 'הזנה ידנית', id: '' };
            transaction.id = txId(transaction);
            S.tx.push(transaction);
            S.overrides[transaction.id] = $('#manual-cat').value;
            S.month = monthKey(date);
            save();
            render();
            closeDrawer();
            e.currentTarget.reset();
            toast(t('transactionAdded'));
        });
        $('#dr-wipe').addEventListener('click', () => {
            if (!S.tx.length) {
                toast(t('nothingToDelete'));
                return;
            }
            const btn = $('#dr-wipe');
            if (btn.dataset.armed) {
                S.tx = [];
                S.overrides = {};
                S.accounts = [];
                S.month = null;
                save();
                closeDrawer();
                render();
                toast(t('allDataDeleted'));
            }
            else {
                btn.dataset.armed = '1';
                btn.textContent = t('confirmDelete');
                setTimeout(() => { delete btn.dataset.armed; btn.textContent = t('deleteAll'); }, 4000);
            }
        });
        $('#dr-addrule').addEventListener('click', () => {
            S.rules.unshift({ id: 'r' + Date.now(), match: '', cat: S.cats[0].id });
            save();
            renderDrawer();
            const first = $('#dr-rules input');
            if (first)
                first.focus();
        });
        $('#dr-addcat').addEventListener('click', () => {
            const id = 'c' + Date.now();
            S.cats.splice(S.cats.length - 1, 0, { id, name: t('newCategory'), kind: 'expense' });
            save();
            renderDrawer();
            render();
        });
        $('#fc-horizon').addEventListener('change', renderForecast);
        ['#q', '#f-cat', '#f-dir', '#f-scope'].forEach((sel) => $(sel).addEventListener('input', renderTx));
        $('#btn-cattbl').addEventListener('click', () => {
            const btn = $('#btn-cattbl');
            const on = btn.getAttribute('aria-pressed') === 'true';
            btn.setAttribute('aria-pressed', on ? 'false' : 'true');
            btn.textContent = on ? t('table') : t('chart');
            $('#cat-list').hidden = !on;
            $('#cat-table').hidden = on;
        });
        window.addEventListener('resize', () => {
            if (!$('#main').hidden) {
                drawWaterline(monthsPresent());
                renderForecast();
            }
        });
    }
    function fillCatFilter() {
        const sel = $('#f-cat');
        const cur = sel.value;
        sel.textContent = '';
        sel.append(el('option', { value: '', text: t('allCategories') }));
        for (const c of S.cats)
            sel.append(el('option', { value: c.id, text: catById(c.id).name, selected: c.id === cur }));
    }
    async function loadResources() {
        try {
            const response = await fetch(`resources/${locale}.json`);
            if (!response.ok)
                throw new Error('resource load failed');
            resources = await response.json();
        }
        catch (error) {
            resources = {};
        }
        applyLocale();
    }
    load();
    captureMarketingAttribution(window.location.search);
    wire();
    loadResources().then(() => { render(); });
    const browserWindow = window;
    browserWindow.__mazan = { S, ingest, recurring, forecast, totals, byCategory, render, handleFiles, autoCat, decorate };
})();
