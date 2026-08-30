import type { AppState, BankTransaction, Category, CategoryKind, Rule } from './domain-model.js';
import { createPrivacySafeSnapshot, sanitizeTransaction } from './privacy.js';

const MAX_TRANSACTIONS = 50_000;
const MAX_RULES = 1_000;
const MAX_CATEGORIES = 1_000;
const MAX_TEXT_LENGTH = 500;
const CATEGORY_KINDS = new Set<CategoryKind>(['expense', 'income', 'neutral']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isBoundedString = (value: unknown, max = MAX_TEXT_LENGTH): value is string =>
  typeof value === 'string' && value.length <= max;

const isFiniteAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000;

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const transactionKeys = [
  'date', 'vdate', 'ref', 'desc', 'out', 'in', 'bal', 'pending', 'source', 'src', 'id', 'cat', 'kind', 'cardKind',
] as const;

function parseTransaction(value: unknown): BankTransaction | null {
  if (!isRecord(value) || !hasOnlyKeys(value, transactionKeys)) return null;
  if (!isBoundedString(value.date, 32) || !isBoundedString(value.vdate, 32)
      || !isBoundedString(value.ref, 200) || !isBoundedString(value.desc)
      || !isFiniteAmount(value.out) || value.out < 0 || !isFiniteAmount(value.in) || value.in < 0
      || !(value.bal === null || isFiniteAmount(value.bal)) || typeof value.pending !== 'boolean'
      || !isBoundedString(value.src, 300)) return null;
  if (value.source !== undefined && value.source !== 'bank' && value.source !== 'card') return null;
  if (value.id !== undefined && !isBoundedString(value.id, 200)) return null;
  if (value.cat !== undefined && !isBoundedString(value.cat, 100)) return null;
  if (value.kind !== undefined && !CATEGORY_KINDS.has(value.kind as CategoryKind)) return null;
  if (value.cardKind !== undefined && value.cardKind !== 'bank' && value.cardKind !== 'external') return null;
  return sanitizeTransaction(value as unknown as BankTransaction);
}

function parseDictionary(value: unknown, maxEntries: number): Record<string, string> | null {
  if (!isRecord(value) || Object.keys(value).length > maxEntries) return null;
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)
        || !isBoundedString(key, 200) || !isBoundedString(item, 200)) return null;
    output[key] = item;
  }
  return output;
}

function parseBudgets(value: unknown): Record<string, number> | null {
  if (!isRecord(value) || Object.keys(value).length > MAX_CATEGORIES) return null;
  const output: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)
        || !isBoundedString(key, 100) || !isFiniteAmount(item) || item < 0) return null;
    output[key] = item;
  }
  return output;
}

function parseRules(value: unknown): Rule[] | null {
  if (!Array.isArray(value) || value.length > MAX_RULES) return null;
  const rules: Rule[] = [];
  for (const item of value) {
    if (!isRecord(item) || !hasOnlyKeys(item, ['id', 'match', 'cat'])
        || !isBoundedString(item.id, 100) || !isBoundedString(item.match, 200)
        || !isBoundedString(item.cat, 100)) return null;
    rules.push({ id: item.id, match: item.match, cat: item.cat });
  }
  return rules;
}

function parseCategories(value: unknown): Category[] | null {
  if (!Array.isArray(value) || value.length > MAX_CATEGORIES) return null;
  const categories: Category[] = [];
  for (const item of value) {
    if (!isRecord(item) || !hasOnlyKeys(item, ['id', 'name', 'kind'])
        || !isBoundedString(item.id, 100) || !isBoundedString(item.name, 200)
        || !CATEGORY_KINDS.has(item.kind as CategoryKind)) return null;
    categories.push({ id: item.id, name: item.name, kind: item.kind as CategoryKind });
  }
  return categories;
}

export interface StateDefaults {
  rules: readonly Rule[];
  cats: readonly Category[];
}

export class AppStateCodec {
  constructor(private readonly defaults: StateDefaults) {}

  decode(value: unknown): AppState | null {
    if (!isRecord(value)) return null;
    // accounts/month are accepted only to migrate legacy local data; neither is copied to the returned state.
    const allowed = ['app', 'version', 'savedAt', 'tx', 'overrides', 'rules', 'cats', 'budgets', 'accounts', 'month'];
    if (!hasOnlyKeys(value, allowed) || !Array.isArray(value.tx) || value.tx.length > MAX_TRANSACTIONS) return null;
    const tx = value.tx.map(parseTransaction);
    if (tx.some((item) => item === null)) return null;
    const overrides = parseDictionary(value.overrides ?? {}, MAX_TRANSACTIONS);
    const restoredRules = value.rules === undefined ? [] : parseRules(value.rules);
    const cats = value.cats === undefined ? [...this.defaults.cats] : parseCategories(value.cats);
    const budgets = parseBudgets(value.budgets ?? {});
    if (!overrides || !restoredRules || !cats?.length || !budgets) return null;
    const rules = [...restoredRules];
    for (const rule of this.defaults.rules) {
      if (!rules.some((candidate) => candidate.match === rule.match && candidate.cat === rule.cat)) rules.push({ ...rule });
    }
    /* A category added to the defaults after a customer last saved would otherwise
       never reach them, because categories are restored wholesale where rules are
       merged. Each missing default returns at its own position rather than on the
       end, so the chart palette — which follows category order — stays put. */
    const restoredCats = [...cats];
    this.defaults.cats.forEach((category, index) => {
      if (!restoredCats.some((candidate) => candidate.id === category.id)) {
        restoredCats.splice(Math.min(index, restoredCats.length), 0, { ...category });
      }
    });
    return { tx: tx as BankTransaction[], overrides, rules, cats: restoredCats, budgets, accounts: [], month: null };
  }
}

export interface StateRepository {
  load(): AppState | null;
  save(state: AppState): void;
}

export class LocalStorageStateRepository implements StateRepository {
  constructor(
    private readonly storage: Storage,
    private readonly key: string,
    private readonly codec: AppStateCodec,
  ) {}

  load(): AppState | null {
    const raw = this.storage.getItem(this.key);
    if (!raw) return null;
    try { return this.codec.decode(JSON.parse(raw)); } catch { return null; }
  }

  save(state: AppState): void {
    this.storage.setItem(this.key, JSON.stringify(createPrivacySafeSnapshot(state)));
  }
}
