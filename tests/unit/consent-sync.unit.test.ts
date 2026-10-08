import { describe, expect, it, vi } from 'vitest';
import { WriteThroughConsentRepository } from '../../fe/src/consent-sync';
import { LocalConsentRepository } from '../../fe/src/consent';

const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
};

describe('write-through consent repository', () => {
  it('writes locally and does not touch the remote when signed out', async () => {
    const local = new LocalConsentRepository(storage());
    const remote = { current: vi.fn(), accept: vi.fn(), withdraw: vi.fn() };
    const repository = new WriteThroughConsentRepository({ local, remote, signedIn: () => false });

    const acceptance = await repository.accept('he');

    expect(acceptance.locale).toBe('he');
    expect(local.current()).toMatchObject({ locale: 'he' });
    expect(remote.accept).not.toHaveBeenCalled();
  });

  it('writes locally first, then writes through to the remote when signed in', async () => {
    const local = new LocalConsentRepository(storage());
    const remote = { current: vi.fn(), accept: vi.fn(async (locale: string) => ({
      purpose: 'cloud_sync', statementVersion: 'v', acceptedAt: '2026-10-08T00:00:00Z', locale,
    })), withdraw: vi.fn() };
    const repository = new WriteThroughConsentRepository({ local, remote, signedIn: () => true });

    const acceptance = await repository.accept('fr');

    expect(acceptance.locale).toBe('fr');
    expect(local.current()).toMatchObject({ locale: 'fr' });
    await vi.waitFor(() => expect(remote.accept).toHaveBeenCalledWith('fr'));
  });

  it('reports a remote failure without reverting the local acceptance', async () => {
    const local = new LocalConsentRepository(storage());
    const onRemoteError = vi.fn();
    const remote = { current: vi.fn(), accept: vi.fn(async () => { throw new Error('network down'); }), withdraw: vi.fn() };
    const repository = new WriteThroughConsentRepository({ local, remote, signedIn: () => true, onRemoteError });

    await repository.accept('he');

    expect(local.current()).not.toBeNull();
    await vi.waitFor(() => expect(onRemoteError).toHaveBeenCalledOnce());
  });

  it('withdraws locally and remotely when signed in', async () => {
    const local = new LocalConsentRepository(storage());
    local.accept('he');
    const remote = { current: vi.fn(), accept: vi.fn(), withdraw: vi.fn(async () => {}) };
    const repository = new WriteThroughConsentRepository({ local, remote, signedIn: () => true });

    await repository.withdraw();

    expect(local.current()).toBeNull();
    await vi.waitFor(() => expect(remote.withdraw).toHaveBeenCalledOnce());
  });

  it('reads current status from local storage only, never the remote', () => {
    const local = new LocalConsentRepository(storage());
    local.accept('he');
    const remote = { current: vi.fn(), accept: vi.fn(), withdraw: vi.fn() };
    const repository = new WriteThroughConsentRepository({ local, remote, signedIn: () => true });

    expect(repository.current()).toMatchObject({ locale: 'he' });
    expect(remote.current).not.toHaveBeenCalled();
  });
});
