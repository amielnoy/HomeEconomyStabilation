import { describe, expect, it } from 'vitest';
import { AppStateCodec, LocalStorageStateRepository } from '../../src/state-repository';

const defaults = {
  rules: [{ id: 'default-transfer', match: 'העברה בנקאית', cat: 'savings' }],
  cats: [{ id: 'other', name: 'אחר', kind: 'expense' as const }],
};

const transaction = {
  date: '2026-08-01', vdate: '2026-08-01', ref: 'secret', desc: 'Shop', out: 42, in: 0,
  bal: 100, pending: false, source: 'bank' as const, src: 'account-123.csv', id: 'tx-1',
};

describe('application state boundary', () => {
  it('maps valid state into a new privacy-safe domain object and merges new defaults', () => {
    const codec = new AppStateCodec(defaults);
    const restored = codec.decode({ tx: [transaction], overrides: {}, rules: [], cats: defaults.cats, budgets: {} });

    expect(restored?.tx[0]).toMatchObject({ ref: '', src: 'bank-report' });
    expect(restored?.rules).toContainEqual(defaults.rules[0]);
    expect(restored?.accounts).toEqual([]);
  });

  /* Categories are restored wholesale where rules are merged, so a category added
     to the defaults after a customer last saved would never have reached them —
     the loans category would have been invisible to every existing customer. */
  it('returns a newly added default category at its own position', () => {
    const withLoans = {
      rules: defaults.rules,
      cats: [
        { id: 'savings', name: 'חיסכון והעברות', kind: 'neutral' as const },
        { id: 'loans', name: 'הלוואות', kind: 'expense' as const },
        { id: 'other', name: 'אחר', kind: 'expense' as const },
      ],
    };
    const saved = [withLoans.cats[0], withLoans.cats[2]];
    const restored = new AppStateCodec(withLoans)
      .decode({ tx: [transaction], overrides: {}, rules: [], cats: saved, budgets: {} });

    // Not appended on the end: the chart palette follows category order.
    expect(restored?.cats.map((category) => category.id)).toEqual(['savings', 'loans', 'other']);
  });

  it('leaves a category the customer renamed alone', () => {
    const renamed = [{ id: 'other', name: 'Something else', kind: 'expense' as const }];
    const restored = new AppStateCodec(defaults)
      .decode({ tx: [transaction], overrides: {}, rules: [], cats: renamed, budgets: {} });

    expect(restored?.cats).toEqual(renamed);
  });

  it.each([
    { tx: [{ ...transaction, cardNumber: '4111111111111111' }], overrides: {}, rules: [], cats: defaults.cats, budgets: {} },
    { tx: [transaction], overrides: JSON.parse('{"__proto__":"polluted"}'), rules: [], cats: defaults.cats, budgets: {} },
    { tx: [transaction], overrides: {}, rules: [{ id: 'x', match: 42, cat: 'other' }], cats: defaults.cats, budgets: {} },
    { tx: [transaction], overrides: {}, rules: [], cats: defaults.cats, budgets: { other: -1 } },
  ])('rejects malformed or unexpected persisted state', (candidate) => {
    expect(new AppStateCodec(defaults).decode(candidate)).toBeNull();
  });

  it('round-trips through a repository without persisting account and report identifiers', () => {
    const storage = new Map<string, string>();
    const storageAdapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    } as Storage;
    const repository = new LocalStorageStateRepository(storageAdapter, 'state', new AppStateCodec(defaults));
    repository.save({
      tx: [transaction], overrides: {}, rules: [], cats: defaults.cats, budgets: {},
      accounts: ['04-279-661711'], month: '2026-08',
    });

    expect(storage.get('state')).not.toMatch(/04-279|account-123|"accounts"/);
    expect(repository.load()?.tx[0].src).toBe('bank-report');
  });
});
