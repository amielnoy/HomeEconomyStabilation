import type { BankTransaction, Category, Rule } from './domain-model.js';

export interface PersistableTransaction {
  date?: string;
  vdate?: string;
  ref?: string;
  desc?: string;
  out?: number;
  in?: number;
  bal?: number | null;
  pending?: boolean;
  src?: string;
  source?: 'bank' | 'card';
  id?: string;
  cat?: string;
  kind?: 'expense' | 'income' | 'neutral';
}

export interface PersistedTransaction extends BankTransaction {
  ref: '';
  src: 'bank-report' | 'card-report' | 'manual-entry';
}

export interface PersistableState<T extends PersistableTransaction = PersistableTransaction> {
  tx: readonly T[];
  overrides: Record<string, string>;
  rules: readonly Rule[];
  cats: readonly Category[];
  budgets: Record<string, number>;
}

export interface PrivacySafeSnapshot extends PersistableState<PersistedTransaction> {
  tx: readonly PersistedTransaction[];
}

const REDACTED = '[redacted]';
const SAFE_SOURCES = new Set(['bank-report', 'card-report', 'manual-entry']);

export function redactFinancialIdentifiers(value: string): string {
  return value
    .replace(/\b(?:IBAN\s*)?[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/giu, REDACTED)
    .replace(/\b(?:cvv|cvc|security\s*code)\s*[:#-]?\s*\d{3,4}\b/giu, REDACTED)
    .replace(/\b(?:\d[ -]?){12,18}\d\b/gu, REDACTED)
    .replace(/\b\d{1,3}[- ]\d{1,4}[- ]\d{4,10}\b/gu, REDACTED)
    /* An Israeli bank account is six to nine digits and a branch is three, so a run
       of digits introduced by an account, branch or card word is the identifier the
       privacy notice promises not to keep. \b is ASCII-only and never fires beside a
       Hebrew letter, so the boundaries are spelled with Unicode lookarounds, and a
       decimal separator disqualifies a match so amounts survive intact. */
    .replace(
      /((?<![\p{L}\p{N}])(?:חשבון|חשבונות|בנק|סניף|כרטיס|account|acct|branch|card|מספר|no|nr)[\s:.#-]*)(\d[\d-]{3,12}\d)(?![\p{L}\p{N}]|[.,]\d)/giu,
      (_match, lead: string) => lead + REDACTED,
    );
}
export function sanitizeTransaction(transaction: PersistableTransaction): PersistedTransaction {
  const source = transaction.source === 'card' ? 'card-report'
    : transaction.src === 'הזנה ידנית' || transaction.src === 'manual-entry' ? 'manual-entry'
      : 'bank-report';
  return {
    date: String(transaction.date || ''),
    vdate: String(transaction.vdate || transaction.date || ''),
    ref: '',
    desc: redactFinancialIdentifiers(String(transaction.desc || '')),
    out: Number(transaction.out || 0),
    in: Number(transaction.in || 0),
    bal: transaction.bal === null || transaction.bal === undefined ? null : Number(transaction.bal),
    pending: Boolean(transaction.pending),
    source: transaction.source,
    src: source,
    ...(transaction.id ? { id: String(transaction.id) } : {}),
    ...(transaction.cat ? { cat: String(transaction.cat) } : {}),
    ...(transaction.kind ? { kind: transaction.kind } : {}),
  };
}

export function createPrivacySafeSnapshot<T extends PersistableTransaction>(state: PersistableState<T>): PrivacySafeSnapshot {
  return {
    tx: state.tx.map(sanitizeTransaction),
    overrides: { ...state.overrides },
    rules: state.rules.map((rule) => ({ id: rule.id, match: rule.match, cat: rule.cat })),
    cats: state.cats.map((category) => ({ id: category.id, name: category.name, kind: category.kind })),
    budgets: { ...state.budgets },
  };
}

export function isPrivacySafeTransaction(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const transaction = value as Record<string, unknown>;
  const allowed = new Set(['date', 'vdate', 'ref', 'desc', 'out', 'in', 'bal', 'pending', 'source', 'src', 'id', 'cat', 'kind']);
  return Object.keys(transaction).every((key) => allowed.has(key))
    && transaction.ref === ''
    && typeof transaction.src === 'string' && SAFE_SOURCES.has(transaction.src)
    && isShortString(transaction.date, 32) && isShortString(transaction.vdate, 32)
    && isShortString(transaction.desc) && transaction.desc === redactFinancialIdentifiers(transaction.desc)
    && typeof transaction.out === 'number' && Number.isFinite(transaction.out) && transaction.out >= 0 && transaction.out <= 1_000_000_000
    && typeof transaction.in === 'number' && Number.isFinite(transaction.in) && transaction.in >= 0 && transaction.in <= 1_000_000_000
    && (transaction.bal === null || (typeof transaction.bal === 'number' && Number.isFinite(transaction.bal) && Math.abs(transaction.bal) <= 1_000_000_000))
    && typeof transaction.pending === 'boolean'
    && (transaction.source === undefined || transaction.source === 'bank' || transaction.source === 'card')
    && (transaction.id === undefined || isShortString(transaction.id, 200))
    && (transaction.cat === undefined || isShortString(transaction.cat, 100))
    && (transaction.kind === undefined || ['expense', 'income', 'neutral'].includes(String(transaction.kind)));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isShortString = (value: unknown, max = 500): value is string => typeof value === 'string' && value.length <= max;
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

export function isPrivacySafeSnapshot(value: unknown): value is PrivacySafeSnapshot {
  if (!isRecord(value) || !onlyKeys(value, ['tx', 'overrides', 'rules', 'cats', 'budgets'])) return false;
  if (!Array.isArray(value.tx) || value.tx.length > 50_000 || !value.tx.every(isPrivacySafeTransaction)) return false;
  const safeKey = (key: string, max: number) => !['__proto__', 'prototype', 'constructor'].includes(key) && isShortString(key, max);
  if (!isRecord(value.overrides) || Object.keys(value.overrides).length > 50_000
      || !Object.entries(value.overrides).every(([key, item]) => safeKey(key, 200) && isShortString(item, 200))) return false;
  if (!Array.isArray(value.rules) || value.rules.length > 1_000 || !value.rules.every((item) =>
    isRecord(item) && onlyKeys(item, ['id', 'match', 'cat'])
    && isShortString(item.id, 100) && isShortString(item.match, 200) && isShortString(item.cat, 100))) return false;
  if (!Array.isArray(value.cats) || value.cats.length > 1_000 || !value.cats.every((item) =>
    isRecord(item) && onlyKeys(item, ['id', 'name', 'kind'])
    && isShortString(item.id, 100) && isShortString(item.name, 200)
    && ['expense', 'income', 'neutral'].includes(String(item.kind)))) return false;
  return isRecord(value.budgets) && Object.keys(value.budgets).length <= 1_000
    && Object.entries(value.budgets).every(([key, item]) =>
      safeKey(key, 100) && typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1_000_000_000);
}
