export interface PersistableTransaction {
  ref?: string;
  desc?: string;
  src?: string;
  source?: 'bank' | 'card';
}

export interface PersistableState<T extends PersistableTransaction = PersistableTransaction> {
  tx: readonly T[];
  overrides: Record<string, unknown>;
  rules: readonly unknown[];
  cats: readonly unknown[];
  budgets: Record<string, unknown>;
}

const REDACTED = '[redacted]';
const SAFE_SOURCES = new Set(['bank-report', 'card-report', 'manual-entry']);

export function redactFinancialIdentifiers(value: string): string {
  return value
    .replace(/\b(?:IBAN\s*)?[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/giu, REDACTED)
    .replace(/\b(?:cvv|cvc|security\s*code)\s*[:#-]?\s*\d{3,4}\b/giu, REDACTED)
    .replace(/\b(?:\d[ -]?){12,18}\d\b/gu, REDACTED)
    .replace(/\b\d{1,3}[- ]\d{1,4}[- ]\d{4,10}\b/gu, REDACTED);
}

export function sanitizeTransaction<T extends PersistableTransaction>(transaction: T): T {
  const source = transaction.source === 'card' ? 'card-report'
    : transaction.src === 'הזנה ידנית' || transaction.src === 'manual-entry' ? 'manual-entry'
      : 'bank-report';
  return {
    ...transaction,
    ref: '',
    desc: redactFinancialIdentifiers(String(transaction.desc || '')),
    src: source,
  };
}

export function createPrivacySafeSnapshot<T extends PersistableTransaction>(state: PersistableState<T>) {
  return {
    tx: state.tx.map(sanitizeTransaction),
    overrides: state.overrides,
    rules: state.rules,
    cats: state.cats,
    budgets: state.budgets,
  };
}

export function isPrivacySafeTransaction(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const transaction = value as PersistableTransaction;
  return (transaction.ref === undefined || transaction.ref === '')
    && (transaction.src === undefined || SAFE_SOURCES.has(transaction.src))
    && (transaction.desc === undefined || transaction.desc === redactFinancialIdentifiers(transaction.desc));
}
