import { describe, expect, it } from 'vitest';
import { reconcileCloudSnapshot } from '../../fe/src/cloud-sync-reconciliation.js';
import type { PrivacySafeSnapshot } from '../../fe/src/privacy.js';

const empty: PrivacySafeSnapshot = { tx: [], overrides: {}, rules: [], cats: [], budgets: {}, goals: [] };
const withOneTransaction: PrivacySafeSnapshot = {
  ...empty,
  tx: [{ date: '2026-01-01', vdate: '2026-01-01', ref: '', desc: 'groceries', out: 100, in: 0, bal: null, pending: false, src: 'manual-entry' }],
};

describe('reconcileCloudSnapshot', () => {
  it('needs nothing when the cloud has no snapshot yet', () => {
    expect(reconcileCloudSnapshot(withOneTransaction, null)).toBe('none');
  });

  it('adopts the cloud snapshot when this device has no transactions of its own', () => {
    expect(reconcileCloudSnapshot(empty, withOneTransaction)).toBe('adopt-cloud');
  });

  it('reports no conflict when the device already matches the cloud', () => {
    expect(reconcileCloudSnapshot(withOneTransaction, withOneTransaction)).toBe('none');
  });

  it('reports a conflict when both sides have data and they differ', () => {
    const otherDevice: PrivacySafeSnapshot = {
      ...empty,
      tx: [{ date: '2026-02-01', vdate: '2026-02-01', ref: '', desc: 'rent', out: 3000, in: 0, bal: null, pending: false, src: 'manual-entry' }],
    };
    expect(reconcileCloudSnapshot(withOneTransaction, otherDevice)).toBe('conflict');
  });
});
