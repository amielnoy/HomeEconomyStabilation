export type CellValue = string | number | Date | boolean;

export interface SpreadsheetCell {
  readonly t: string;
  readonly v: CellValue;
}

export interface Workbook {
  readonly sheets: ReadonlyArray<{
    readonly name: string;
    readonly rows: ReadonlyArray<ReadonlyArray<SpreadsheetCell | null>>;
  }>;
}

export interface TransactionRecord {
  readonly date: string;
  readonly vdate: string;
  readonly ref: string;
  readonly desc: string;
  readonly out: number;
  readonly in: number;
  readonly bal: number | null;
  readonly pending: boolean;
  readonly source: 'card';
  readonly src: string;
  id: string;
}

export interface WorkbookReader {
  (data: ArrayBuffer, filename: string): Promise<Workbook>;
}

export interface ImportStrategy {
  canHandle(workbook: Workbook): boolean;
  import(workbook: Workbook, filename: string): TransactionRecord[];
}

type HeaderKey = 'date' | 'ref' | 'desc' | 'amount' | 'in' | 'out';
type HeaderMap = Partial<Record<HeaderKey, number>>;

const HEADER_PATTERNS: Record<HeaderKey, RegExp[]> = {
  date: [/^תאריך$/, /תאריך\s*עסקה/, /מועד\s*עסקה/],
  ref: [/אסמכתא/, /מספר\s*עסקה/, /מספר\s*כרטיס/],
  desc: [/שם\s*בית\s*עסק/, /בית\s*עסק/, /שם\s*העסק/, /תיאור/, /פרטים/, /ספק/],
  amount: [/סכום\s*עסקה/, /סכום\s*לחיוב/, /^סכום$/],
  out: [/^חיוב/, /^חובה/, /סכום\s*חיוב/],
  in: [/^זיכוי/, /^זכות/, /החזר/],
};

/* Issuers write the same column with or without the definite article — Max exports
   "שם בית העסק" and "תאריך העסקה" where Cal writes "שם בית עסק" and "תאריך עסקה" — so a
   pattern spelled one way silently misses the other issuer's export, and the whole file
   is reported unreadable. Matching the de-articled text as well as the original lets one
   pattern cover both spellings without doubling the list. */
const withoutArticles = (text: string): string => text.replace(/(^|\s)ה(?=\S{2,})/g, '$1');
export const headerMatches = (patterns: readonly RegExp[], text: string): boolean =>
  patterns.some((pattern) => pattern.test(text) || pattern.test(withoutArticles(text)));

const clean = (value: unknown): string => String(value ?? '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
const numeric = (cell: SpreadsheetCell | null | undefined): number => {
  const value = cell?.v;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    /* Accounting exports write a refund as "(20)"; stripping the brackets alone would
       book it as a charge of 20. */
    const parsed = Number(value.replace(/[₪,\s]/g, '').replace(/^\((.+)\)$/, '-$1'));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const dateValue = (cell: SpreadsheetCell | null | undefined): string | null => {
  const value = cell?.v;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = clean(value);
  const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!match) return text.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  const day = match[1]!;
  const month = match[2]!;
  const year = match[3]!;
  return `${year.length === 2 ? `20${year}` : year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

const headerMap = (row: ReadonlyArray<SpreadsheetCell | null>): HeaderMap => {
  const map: HeaderMap = {};
  row.forEach((cell, index) => {
    if (!cell || cell.t !== 's') return;
    const text = clean(cell.v);
    for (const [key, patterns] of Object.entries(HEADER_PATTERNS) as Array<[HeaderKey, RegExp[]]>) {
      if (map[key] === undefined && headerMatches(patterns, text)) map[key] = index;
    }
  });
  return map;
};

const isHeaderRow = (map: HeaderMap): boolean => map.date !== undefined && map.desc !== undefined
  && (map.amount !== undefined || map.out !== undefined || map.in !== undefined);

const hashId = (transaction: Omit<TransactionRecord, 'id'>): string => {
  const raw = [transaction.date, transaction.ref, transaction.out.toFixed(2), transaction.in.toFixed(2), transaction.desc].join('|');
  let hash = 5381;
  for (let index = 0; index < raw.length; index += 1) hash = ((hash * 33) ^ raw.charCodeAt(index)) >>> 0;
  return `${hash.toString(36)}-${raw.length.toString(36)}`;
};

export class CreditCardImportStrategy implements ImportStrategy {
  canHandle(workbook: Workbook): boolean {
    return workbook.sheets.some((sheet) => sheet.rows.some((row) => isHeaderRow(headerMap(row))));
  }

  import(workbook: Workbook, filename: string): TransactionRecord[] {
    const transactions: TransactionRecord[] = [];
    for (const sheet of workbook.sheets) {
      const headerIndex = sheet.rows.findIndex((row) => isHeaderRow(headerMap(row)));
      if (headerIndex < 0) continue;
      const map = headerMap(sheet.rows[headerIndex]!);
      for (const row of sheet.rows.slice(headerIndex + 1)) {
        const date = dateValue(row[map.date ?? -1]);
        if (!date) continue;
        const desc = clean(row[map.desc ?? -1]?.v);
        /* The billed column wins over the transaction column: on a foreign-currency
           purchase "סכום עסקה" is in the merchant's currency and only "סכום חיוב" is the
           shekels that left the account. */
        const signed = numeric(row[map.out ?? map.amount ?? -1]);
        const credited = map.in === undefined ? 0 : Math.abs(numeric(row[map.in]));
        /* A statement with its own credit column still keeps charges in the charge
           column; reading only the credit column there dropped every charge in the file. */
        const out = signed > 0 ? signed : 0;
        const incoming = credited || (signed < 0 ? -signed : 0);
        if (!out && !incoming) continue;
        const transaction: Omit<TransactionRecord, 'id'> = {
          date, vdate: date, ref: clean(row[map.ref ?? -1]?.v), desc, out, in: incoming,
          bal: null, pending: /המתנה|זמני/.test(clean(sheet.name)), source: 'card', src: filename,
        };
        transactions.push({ ...transaction, id: hashId(transaction) });
      }
    }
    return transactions;
  }
}

export class ImportStrategyFactory {
  constructor(private readonly strategies: ReadonlyArray<ImportStrategy>) {}

  select(workbook: Workbook): ImportStrategy {
    const strategy = this.strategies.find((candidate) => candidate.canHandle(workbook));
    if (!strategy) throw new Error('לא זוהה מבנה של דוח כרטיס אשראי');
    return strategy;
  }
}

export interface CreditCardImporterBridge {
  import(workbook: Workbook, filename: string): TransactionRecord[];
}

const factory = new ImportStrategyFactory([new CreditCardImportStrategy()]);
export const creditCardImporter: CreditCardImporterBridge = {
  import: (workbook, filename) => factory.select(workbook).import(workbook, filename),
};
