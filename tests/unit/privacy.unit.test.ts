import { describe, expect, it } from 'vitest';
import {
  createPrivacySafeSnapshot, isPrivacySafeTransaction, redactFinancialIdentifiers,
} from '../../src/privacy';

describe('privacy-safe persistence', () => {
  it.each([
    'account 04-279-661711',
    'card 4111 1111 1111 1111',
    'IBAN GB82WEST12345698765432',
    'CVV 123',
  ])('redacts a financial identifier from %s', (value) => {
    expect(redactFinancialIdentifiers(value)).not.toMatch(/661711|4111|GB82|123$/);
  });

  it('keeps useful transaction data but removes identifiers and report names', () => {
    const snapshot = createPrivacySafeSnapshot({
      tx: [{
        date: '2026-08-01', desc: 'Shop', out: 42, ref: '4111111111111111',
        src: 'card-4111111111111111.csv', source: 'card' as const,
      }],
      overrides: {}, rules: [], cats: [], budgets: {},
    });

    expect(snapshot).not.toHaveProperty('accounts');
    expect(snapshot.tx[0]).toMatchObject({ desc: 'Shop', out: 42, ref: '', src: 'card-report' });
    expect(isPrivacySafeTransaction(snapshot.tx[0])).toBe(true);
  });

  it('persists only allowlisted transaction fields and drops future sensitive properties', () => {
    const snapshot = createPrivacySafeSnapshot({
      tx: [{
        date: '2026-08-01', vdate: '2026-08-01', desc: 'Shop', out: 42, in: 0,
        bal: null, pending: false, ref: 'reference', src: 'statement.csv', source: 'card',
        accountNumber: '04-279-661711', cardNumber: '4111111111111111', notes: 'CVV 123',
      }],
      overrides: {}, rules: [], cats: [], budgets: {},
    });

    expect(snapshot.tx[0]).not.toHaveProperty('accountNumber');
    expect(snapshot.tx[0]).not.toHaveProperty('cardNumber');
    expect(snapshot.tx[0]).not.toHaveProperty('notes');
    expect(isPrivacySafeTransaction({ ...snapshot.tx[0], accountNumber: 'secret' })).toBe(false);
  });

  it('rejects unsanitized transactions at the cloud boundary', () => {
    expect(isPrivacySafeTransaction({ ref: 'secret-reference', src: 'statement.csv', desc: 'Shop' })).toBe(false);
    expect(isPrivacySafeTransaction({ ref: '', src: 'bank-report', desc: 'card 4111111111111111' })).toBe(false);
  });
});

describe('account identifiers the privacy notice promises not to keep', () => {
  it('redacts a digit run introduced by an account, branch or card word', () => {
    expect(redactFinancialIdentifiers('חשבון 123456789 העברה')).toBe('חשבון [redacted] העברה');
    expect(redactFinancialIdentifiers('account 12345678 transfer')).toBe('account [redacted] transfer');
    expect(redactFinancialIdentifiers('כרטיס 4580-1234')).toBe('כרטיס [redacted]');
  });

  it('leaves amounts and counts alone, which share the same shape', () => {
    for (const description of ['שופרסל דיל 1,234.56', 'משיכה מבנקט 250.00', 'תשלום 3 מתוך 12']) {
      expect(redactFinancialIdentifiers(description)).toBe(description);
    }
  });

  it('is idempotent, so a redacted description survives a second save unchanged', () => {
    const once = redactFinancialIdentifiers('חשבון 123456789');
    expect(redactFinancialIdentifiers(once)).toBe(once);
  });
});
