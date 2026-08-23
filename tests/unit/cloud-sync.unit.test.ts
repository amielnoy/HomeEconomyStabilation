import { describe, expect, it, vi } from 'vitest';
import {
  CloudSyncError, SupabaseSnapshotRepository, isCloudStatePayload, type CloudStatePayload,
} from '../../src/cloud-sync';

const payload = (): CloudStatePayload => ({
  tx: [], overrides: {}, rules: [], cats: [], budgets: {}, accounts: [],
});

describe('Supabase snapshot repository', () => {
  it('validates the bounded application snapshot shape', () => {
    expect(isCloudStatePayload(payload())).toBe(true);
    expect(isCloudStatePayload({ ...payload(), tx: 'not-an-array' })).toBe(false);
    expect(isCloudStatePayload({ ...payload(), accounts: Array(101).fill('x') })).toBe(false);
  });

  it('fails before a network request when the user is signed out', async () => {
    const fetchImpl = vi.fn();
    const repository = new SupabaseSnapshotRepository({ accessToken: async () => null, fetchImpl });

    await expect(repository.load()).rejects.toMatchObject<Partial<CloudSyncError>>({
      code: 'authentication_required', status: 401,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the JWT only in the authorization header and returns a versioned snapshot', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer user.jwt.token' });
      expect(init?.body).not.toContain('user.jwt.token');
      return new Response(JSON.stringify({ snapshot: { schemaVersion: 1, payload: payload(), updatedAt: '2026-08-23T12:00:00Z' } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    const repository = new SupabaseSnapshotRepository({
      accessToken: async () => 'user.jwt.token', fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(repository.save(payload())).resolves.toMatchObject({ schemaVersion: 1, payload: payload() });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
