import { describe, expect, it } from 'vitest';
import { CLOUD_CONSENT_KEY, CLOUD_CONSENT_VERSION, LocalConsentRepository } from '../../src/consent';

const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  };
};

describe('local consent repository', () => {
  it('records a versioned, minimal acceptance without financial data or a typed name', () => {
    const store = storage();
    const repository = new LocalConsentRepository(store);
    const acceptance = repository.accept('he', new Date('2026-08-23T12:00:00Z'));

    expect(acceptance).toEqual({
      purpose: 'cloud_sync', statementVersion: CLOUD_CONSENT_VERSION,
      acceptedAt: '2026-08-23T12:00:00.000Z', locale: 'he',
    });
    expect(store.values.get(CLOUD_CONSENT_KEY)).not.toMatch(/transaction|account|name/i);
  });

  it('rejects stale or malformed consent and supports withdrawal', () => {
    const store = storage();
    const repository = new LocalConsentRepository(store);
    store.setItem(CLOUD_CONSENT_KEY, JSON.stringify({ statementVersion: 'old' }));
    expect(repository.current()).toBeNull();

    repository.accept('fr');
    expect(repository.current()?.locale).toBe('fr');
    repository.withdraw();
    expect(repository.current()).toBeNull();
  });
});
