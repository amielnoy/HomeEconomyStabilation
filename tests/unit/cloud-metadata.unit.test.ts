import { describe, expect, it, vi } from 'vitest';
import { SupabaseConsentRepository, SupabaseProfileRepository } from '../../src/cloud-metadata';
import { CLOUD_CONSENT_VERSION } from '../../src/consent';

const token = async () => 'user.jwt.token';

describe('Supabase profile and consent repositories', () => {
  it('stores and validates the preferred locale without putting the token in the body', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.body).toBe(JSON.stringify({ preferredLocale: 'fr' }));
      expect(init?.body).not.toContain('user.jwt.token');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer user.jwt.token' });
      return Response.json({ profile: {
        preferredLocale: 'fr', createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:00:00Z',
      } });
    });
    const repository = new SupabaseProfileRepository({ accessToken: token, fetchImpl: fetchImpl as typeof fetch });
    await expect(repository.save('fr')).resolves.toMatchObject({ preferredLocale: 'fr' });
  });

  it('records and withdraws the current consent statement through Supabase', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json({ consent: {
        purpose: 'cloud_sync', statementVersion: CLOUD_CONSENT_VERSION, locale: 'he',
        acceptedAt: '2026-08-25T10:00:00Z', withdrawnAt: null,
      } });
    });
    const repository = new SupabaseConsentRepository({ accessToken: token, fetchImpl: fetchImpl as typeof fetch });
    await expect(repository.accept('he')).resolves.toMatchObject({ statementVersion: CLOUD_CONSENT_VERSION });
    await expect(repository.withdraw()).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenLastCalledWith('/api/consents/cloud-sync', expect.objectContaining({ method: 'DELETE', body: undefined }));
  });

  it('rejects malformed metadata returned by the server', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ profile: { preferredLocale: 'xx' } }));
    const repository = new SupabaseProfileRepository({ accessToken: token, fetchImpl: fetchImpl as typeof fetch });
    await expect(repository.load()).rejects.toMatchObject({ code: 'invalid_server_profile', status: 502 });
  });
});
