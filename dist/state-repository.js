import { createPrivacySafeSnapshot, sanitizeTransaction } from './privacy.js';
const MAX_TRANSACTIONS = 50_000;
const MAX_RULES = 1_000;
const MAX_CATEGORIES = 1_000;
const MAX_TEXT_LENGTH = 500;
const CATEGORY_KINDS = new Set(['expense', 'income', 'neutral']);
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isBoundedString = (value, max = MAX_TEXT_LENGTH) => typeof value === 'string' && value.length <= max;
const isFiniteAmount = (value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000;
const hasOnlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
const transactionKeys = [
    'date', 'vdate', 'ref', 'desc', 'out', 'in', 'bal', 'pending', 'source', 'src', 'id', 'cat', 'kind',
];
function parseTransaction(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, transactionKeys))
        return null;
    if (!isBoundedString(value.date, 32) || !isBoundedString(value.vdate, 32)
        || !isBoundedString(value.ref, 200) || !isBoundedString(value.desc)
        || !isFiniteAmount(value.out) || value.out < 0 || !isFiniteAmount(value.in) || value.in < 0
        || !(value.bal === null || isFiniteAmount(value.bal)) || typeof value.pending !== 'boolean'
        || !isBoundedString(value.src, 300))
        return null;
    if (value.source !== undefined && value.source !== 'bank' && value.source !== 'card')
        return null;
    if (value.id !== undefined && !isBoundedString(value.id, 200))
        return null;
    if (value.cat !== undefined && !isBoundedString(value.cat, 100))
        return null;
    if (value.kind !== undefined && !CATEGORY_KINDS.has(value.kind))
        return null;
    return sanitizeTransaction(value);
}
function parseDictionary(value, maxEntries) {
    if (!isRecord(value) || Object.keys(value).length > maxEntries)
        return null;
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)
            || !isBoundedString(key, 200) || !isBoundedString(item, 200))
            return null;
        output[key] = item;
    }
    return output;
}
function parseBudgets(value) {
    if (!isRecord(value) || Object.keys(value).length > MAX_CATEGORIES)
        return null;
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)
            || !isBoundedString(key, 100) || !isFiniteAmount(item) || item < 0)
            return null;
        output[key] = item;
    }
    return output;
}
function parseRules(value) {
    if (!Array.isArray(value) || value.length > MAX_RULES)
        return null;
    const rules = [];
    for (const item of value) {
        if (!isRecord(item) || !hasOnlyKeys(item, ['id', 'match', 'cat'])
            || !isBoundedString(item.id, 100) || !isBoundedString(item.match, 200)
            || !isBoundedString(item.cat, 100))
            return null;
        rules.push({ id: item.id, match: item.match, cat: item.cat });
    }
    return rules;
}
function parseCategories(value) {
    if (!Array.isArray(value) || value.length > MAX_CATEGORIES)
        return null;
    const categories = [];
    for (const item of value) {
        if (!isRecord(item) || !hasOnlyKeys(item, ['id', 'name', 'kind'])
            || !isBoundedString(item.id, 100) || !isBoundedString(item.name, 200)
            || !CATEGORY_KINDS.has(item.kind))
            return null;
        categories.push({ id: item.id, name: item.name, kind: item.kind });
    }
    return categories;
}
export class AppStateCodec {
    defaults;
    constructor(defaults) {
        this.defaults = defaults;
    }
    decode(value) {
        if (!isRecord(value))
            return null;
        // accounts/month are accepted only to migrate legacy local data; neither is copied to the returned state.
        const allowed = ['app', 'version', 'savedAt', 'tx', 'overrides', 'rules', 'cats', 'budgets', 'accounts', 'month'];
        if (!hasOnlyKeys(value, allowed) || !Array.isArray(value.tx) || value.tx.length > MAX_TRANSACTIONS)
            return null;
        const tx = value.tx.map(parseTransaction);
        if (tx.some((item) => item === null))
            return null;
        const overrides = parseDictionary(value.overrides ?? {}, MAX_TRANSACTIONS);
        const restoredRules = value.rules === undefined ? [] : parseRules(value.rules);
        const cats = value.cats === undefined ? [...this.defaults.cats] : parseCategories(value.cats);
        const budgets = parseBudgets(value.budgets ?? {});
        if (!overrides || !restoredRules || !cats?.length || !budgets)
            return null;
        const rules = [...restoredRules];
        for (const rule of this.defaults.rules) {
            if (!rules.some((candidate) => candidate.match === rule.match && candidate.cat === rule.cat))
                rules.push({ ...rule });
        }
        return { tx: tx, overrides, rules, cats, budgets, accounts: [], month: null };
    }
}
export class LocalStorageStateRepository {
    storage;
    key;
    codec;
    constructor(storage, key, codec) {
        this.storage = storage;
        this.key = key;
        this.codec = codec;
    }
    load() {
        const raw = this.storage.getItem(this.key);
        if (!raw)
            return null;
        try {
            return this.codec.decode(JSON.parse(raw));
        }
        catch {
            return null;
        }
    }
    save(state) {
        this.storage.setItem(this.key, JSON.stringify(createPrivacySafeSnapshot(state)));
    }
}
