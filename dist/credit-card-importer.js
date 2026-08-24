const HEADER_PATTERNS = {
    date: [/^תאריך$/, /תאריך\s*עסקה/, /מועד\s*עסקה/],
    ref: [/אסמכתא/, /מספר\s*עסקה/, /מספר\s*כרטיס/],
    desc: [/שם\s*בית\s*עסק/, /בית\s*עסק/, /שם\s*העסק/, /תיאור/, /פרטים/, /ספק/],
    amount: [/סכום\s*עסקה/, /סכום\s*לחיוב/, /^סכום$/],
    out: [/^חיוב/, /^חובה/, /סכום\s*חיוב/],
    in: [/^זיכוי/, /^זכות/, /החזר/],
};
const clean = (value) => String(value ?? '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
const numeric = (cell) => {
    const value = cell?.v;
    if (typeof value === 'number')
        return value;
    if (typeof value === 'string') {
        const parsed = Number(value.replace(/[₪,\s()]/g, ''));
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
};
const dateValue = (cell) => {
    const value = cell?.v;
    if (value instanceof Date)
        return value.toISOString().slice(0, 10);
    const text = clean(value);
    const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (!match)
        return text.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
    const day = match[1];
    const month = match[2];
    const year = match[3];
    return `${year.length === 2 ? `20${year}` : year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};
const headerMap = (row) => {
    const map = {};
    row.forEach((cell, index) => {
        if (!cell || cell.t !== 's')
            return;
        const text = clean(cell.v);
        for (const [key, patterns] of Object.entries(HEADER_PATTERNS)) {
            if (map[key] === undefined && patterns.some((pattern) => pattern.test(text)))
                map[key] = index;
        }
    });
    return map;
};
const hashId = (transaction) => {
    const raw = [transaction.date, transaction.ref, transaction.out.toFixed(2), transaction.in.toFixed(2), transaction.desc].join('|');
    let hash = 5381;
    for (let index = 0; index < raw.length; index += 1)
        hash = ((hash * 33) ^ raw.charCodeAt(index)) >>> 0;
    return `${hash.toString(36)}-${raw.length.toString(36)}`;
};
export class CreditCardImportStrategy {
    canHandle(workbook) {
        return workbook.sheets.some((sheet) => sheet.rows.some((row) => {
            const map = headerMap(row);
            return map.date !== undefined && map.desc !== undefined && (map.amount !== undefined || map.out !== undefined);
        }));
    }
    import(workbook, filename) {
        const transactions = [];
        for (const sheet of workbook.sheets) {
            const headerIndex = sheet.rows.findIndex((row) => {
                const map = headerMap(row);
                return map.date !== undefined && map.desc !== undefined && (map.amount !== undefined || map.out !== undefined);
            });
            if (headerIndex < 0)
                continue;
            const map = headerMap(sheet.rows[headerIndex]);
            for (const row of sheet.rows.slice(headerIndex + 1)) {
                const date = dateValue(row[map.date ?? -1]);
                if (!date)
                    continue;
                const desc = clean(row[map.desc ?? -1]?.v);
                const rawAmount = numeric(row[map.amount ?? map.out ?? -1]);
                const out = map.in === undefined && rawAmount >= 0 ? rawAmount : 0;
                const incoming = map.in === undefined && rawAmount < 0 ? -rawAmount : numeric(row[map.in ?? -1]);
                if (!out && !incoming)
                    continue;
                const transaction = {
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
    strategies;
    constructor(strategies) {
        this.strategies = strategies;
    }
    select(workbook) {
        const strategy = this.strategies.find((candidate) => candidate.canHandle(workbook));
        if (!strategy)
            throw new Error('לא זוהה מבנה של דוח כרטיס אשראי');
        return strategy;
    }
}
const factory = new ImportStrategyFactory([new CreditCardImportStrategy()]);
export const creditCardImporter = {
    import: (workbook, filename) => factory.select(workbook).import(workbook, filename),
};
