import type { BankTransaction } from './domain-model.js';
import { headerMatches, type SpreadsheetCell, type Workbook } from './credit-card-importer.js';

const BIDI = /[‎‏‪-‮⁦-⁩]/g;
type HeaderKey = 'date' | 'vdate' | 'ref' | 'desc' | 'out' | 'in' | 'amt' | 'bal';
type HeaderMap = Partial<Record<HeaderKey, number>>;

/* A statement exported from an English interface carries English headings; matching only
   the Hebrew ones rejected the file outright. */
const HEADERS: Record<HeaderKey, RegExp[]> = {
  date: [/^תאריך$/, /^תאריך\s*פעולה/, /^תאריך\s*עסקה/, /תאריך\s*רכישה/, /מועד\s*עסקה/, /^date$/i, /(transaction|purchase|posting)\s*date/i],
  vdate: [/תאריך\s*ערך/, /value\s*date/i],
  ref: [/אסמכתא/, /מספר\s*אסמכתא/, /reference/i],
  desc: [/תיאור\s*פעולה/, /^תיאור$/, /פרטים/, /^סוג\s*תנועה/, /שם\s*בית\s*עסק/, /בית\s*עסק/, /שם\s*העסק/, /ספק/, /merchant/i, /business/i, /description/i, /details/i, /payee/i, /narrative/i],
  out: [/^חובה/, /^חיוב/, /^יציאה/, /סכום\s*חיוב/, /סכום\s*עסקה/, /^debit$/i, /^charge/i, /^withdrawal/i, /(billing|billed)\s*amount/i],
  in: [/^זכות/, /^זיכוי/, /^כניסה/, /^credit$/i, /^deposit/i],
  amt: [/^סכום/, /^amount/i],
  bal: [/יתרה/, /balance/i],
};

export const cleanTransactionText = (value: unknown): string =>
  String(value ?? '').replace(BIDI, '').replace(/\s+/g, ' ').trim();

const numberValue = (cell: SpreadsheetCell | null | undefined): number => {
  const value = cell?.v;
  if (typeof value === 'number') return value;
  if (value instanceof Date || value === undefined) return 0;
  const normalized = String(value).replace(BIDI, '').replace(/[₪,\s]/g, '').replace(/[()]/g, '');
  if (!normalized || normalized === '-') return 0;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const dateValue = (cell: SpreadsheetCell | null | undefined): string | null => {
  const value = cell?.v;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = cleanTransactionText(value);
  const local = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (local) {
    const day = local[1]!;
    const month = local[2]!;
    const rawYear = local[3]!;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return text.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
};

const matchHeader = (value: unknown): HeaderKey | null => {
  const text = cleanTransactionText(value);
  for (const [key, patterns] of Object.entries(HEADERS) as Array<[HeaderKey, RegExp[]]>) {
    if (headerMatches(patterns, text)) return key;
  }
  return null;
};

const findHeader = (rows: ReadonlyArray<ReadonlyArray<SpreadsheetCell | null>>) => {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 30); rowIndex += 1) {
    const map: HeaderMap = {};
    const row = rows[rowIndex] ?? [];
    row.forEach((cell, column) => {
      if (!cell || cell.t !== 's') return;
      const key = matchHeader(cell.v);
      if (key && map[key] === undefined) map[key] = column;
    });
    if (map.date !== undefined && map.desc !== undefined
        && (map.out !== undefined || map.in !== undefined || map.amt !== undefined)) return { row: rowIndex, map };
  }
  return null;
};

export function transactionId(transaction: Pick<BankTransaction, 'date' | 'ref' | 'out' | 'in' | 'desc'>): string {
  const raw = [transaction.date, transaction.ref, transaction.out.toFixed(2), transaction.in.toFixed(2), transaction.desc].join('|');
  let hash = 5381;
  for (let index = 0; index < raw.length; index += 1) hash = ((hash * 33) ^ raw.charCodeAt(index)) >>> 0;
  return `${hash.toString(36)}-${raw.length.toString(36)}`;
}

export interface BankImportResult { rows: BankTransaction[]; account: string | null }

export class BankImportStrategy {
  import(workbook: Workbook, filename: string, source: 'bank' | 'card' = 'bank'): BankImportResult {
    const found: BankTransaction[] = [];
    let account: string | null = null;
    for (const sheet of workbook.sheets) {
      const rows = sheet.rows ?? [];
      for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12) && !account; rowIndex += 1) {
        const row = rows[rowIndex] ?? [];
        for (let column = 0; column < row.length; column += 1) {
          const cell = row[column];
          if (cell?.t === 's' && /^חשבון/.test(cleanTransactionText(cell.v))) {
            const next = row[column + 1];
            if (next) account = cleanTransactionText(next.v);
          }
        }
      }
      const header = findHeader(rows);
      if (!header) continue;
      const pending = /המתנה|זמני/.test(cleanTransactionText(sheet.name));
      for (const row of rows.slice(header.row + 1)) {
        /* A reader that ever hands back a hole must cost a skipped row, not the file. */
        if (!row) continue;
        const date = dateValue(row[header.map.date ?? -1]);
        if (!date) continue;
        const desc = cleanTransactionText(row[header.map.desc ?? -1]?.v);
        let out = header.map.out !== undefined ? Math.abs(numberValue(row[header.map.out])) : 0;
        let incoming = header.map.in !== undefined ? Math.abs(numberValue(row[header.map.in])) : 0;
        if (source === 'card' && header.map.out !== undefined && header.map.in === undefined) {
          const signed = numberValue(row[header.map.out]);
          out = signed >= 0 ? signed : 0;
          incoming = signed < 0 ? -signed : 0;
        }
        if (header.map.amt !== undefined && !out && !incoming) {
          const amount = numberValue(row[header.map.amt]);
          if (source === 'card') { if (amount < 0) incoming = -amount; else out = amount; }
          else if (amount < 0) out = -amount; else incoming = amount;
        }
        if (!out && !incoming) continue;
        const balance = header.map.bal === undefined ? null : numberValue(row[header.map.bal]);
        const transaction: BankTransaction = {
          date,
          vdate: header.map.vdate === undefined ? date : dateValue(row[header.map.vdate]) ?? date,
          ref: cleanTransactionText(row[header.map.ref ?? -1]?.v),
          desc,
          out,
          in: incoming,
          bal: balance === 0 ? null : balance,
          pending,
          source,
          src: filename,
        };
        transaction.id = transactionId(transaction);
        found.push(transaction);
      }
    }
    return { rows: found, account };
  }
}

export const bankImporter = new BankImportStrategy();
