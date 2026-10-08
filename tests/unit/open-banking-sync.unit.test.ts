import { describe, expect, it } from 'vitest';
import { mergeSyncedTransactions } from '../../fe/src/open-banking-sync';
import type { BankTransaction } from '../../fe/src/domain-model';

const row = (id: string, desc = 'Groceries'): BankTransaction => ({
  date: '2026-10-04', vdate: '2026-10-04', ref: '', desc, out: 42, in: 0, bal: null,
  pending: false, source: 'bank', src: 'open-banking', id,
});

describe('merging synced transactions', () => {
  it('adds every row the first time', () => {
    const result = mergeSyncedTransactions([], [row('txn-1'), row('txn-2')]);
    expect(result.merged).toHaveLength(2);
    expect(result.added).toBe(2);
    expect(result.duplicates).toBe(0);
  });

  it('does not duplicate a row already present by id, syncing twice', () => {
    const existing = [row('txn-1')];
    const result = mergeSyncedTransactions(existing, [row('txn-1'), row('txn-2')]);
    expect(result.merged.map((t) => t.id)).toEqual(['txn-1', 'txn-2']);
    expect(result.added).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  it('does not duplicate a row the same id already imported from a manual statement', () => {
    const existing: BankTransaction[] = [{ ...row('txn-1'), src: 'bank-report' }];
    const result = mergeSyncedTransactions(existing, [row('txn-1')]);
    expect(result.merged).toHaveLength(1);
    expect(result.added).toBe(0);
    expect(result.duplicates).toBe(1);
    // The pre-existing row is left exactly as it was — sync adds, it never overwrites.
    expect(result.merged[0]!.src).toBe('bank-report');
  });

  it('leaves unrelated existing transactions untouched', () => {
    const unrelated = row('txn-9', 'Rent');
    const result = mergeSyncedTransactions([unrelated], [row('txn-1')]);
    expect(result.merged).toEqual([unrelated, row('txn-1')]);
  });
});
