import { describe, expect, it, vi } from 'vitest';
import { SupabaseConsentRepository, SupabaseProfileRepository } from '../../fe/src/cloud-metadata';
import { CLOUD_CONSENT_VERSION, OPEN_BANKING_CONSENT_VERSION } from '../../fe/src/consent';

describe('Supabase profile and consent repositories', () => {
  it('stores and validates the preferred locale with credentials included, no token in the body or headers', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.body).toBe(JSON.stringify({ preferredLocale: 'fr' }));
      expect(init?.body).not.toContain('user.jwt.token');
      expect(init?.credentials).toBe('include');
      expect(init?.headers ?? {}).not.toHaveProperty('Authorization');
      return Response.json({ profile: {
        preferredLocale: 'fr', createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:00:00Z',
      } });
    });
    const repository = new SupabaseProfileRepository({ fetchImpl: fetchImpl as typeof fetch });
    await expect(repository.save('fr')).resolves.toMatchObject({ preferredLocale: 'fr' });
  });

  it('records and withdraws the current consent statement through Supabase', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.credentials).toBe('include');
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json({ consent: {
        purpose: 'cloud_sync', statementVersion: CLOUD_CONSENT_VERSION, locale: 'he',
        acceptedAt: '2026-08-25T10:00:00Z', withdrawnAt: null,
      } });
    });
    const repository = new SupabaseConsentRepository({ fetchImpl: fetchImpl as typeof fetch });
    await expect(repository.accept('he')).resolves.toMatchObject({ statementVersion: CLOUD_CONSENT_VERSION });
    await expect(repository.withdraw()).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenLastCalledWith('/api/consents/cloud-sync', expect.objectContaining({ method: 'DELETE', body: undefined }));
  });

  it('rejects malformed metadata returned by the server', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ profile: { preferredLocale: 'xx' } }));
    const repository = new SupabaseProfileRepository({ fetchImpl: fetchImpl as typeof fetch });
    await expect(repository.load()).rejects.toMatchObject({ code: 'invalid_server_profile', status: 502 });
  });

  it('surfaces a 401 from the server as a stable error when signed out', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 'authentication_required' }), { status: 401 }));
    const repository = new SupabaseProfileRepository({ fetchImpl: fetchImpl as typeof fetch });
    await expect(repository.load()).rejects.toMatchObject({ code: 'authentication_required', status: 401 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('records and withdraws an open-banking consent at its own endpoint, independent of purpose', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(url).toBe('/api/consents/open-banking');
      return Response.json({ consent: {
        purpose: 'open_banking', statementVersion: OPEN_BANKING_CONSENT_VERSION, locale: 'he',
        acceptedAt: '2026-10-08T10:00:00Z', withdrawnAt: null,
      } });
    });
    const repository = new SupabaseConsentRepository({ purpose: 'open_banking', fetchImpl: fetchImpl as typeof fetch });
    await expect(repository.accept('he')).resolves.toMatchObject({
      purpose: 'open_banking', statementVersion: OPEN_BANKING_CONSENT_VERSION,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects an open-banking response carrying the wrong purpose or statement version', async () => {
    const wrongPurpose = vi.fn(async () => Response.json({ consent: {
      purpose: 'cloud_sync', statementVersion: OPEN_BANKING_CONSENT_VERSION, locale: 'he',
      acceptedAt: '2026-10-08T10:00:00Z', withdrawnAt: null,
    } }));
    const repository = new SupabaseConsentRepository({ purpose: 'open_banking', fetchImpl: wrongPurpose as typeof fetch });
    await expect(repository.current()).rejects.toMatchObject({ code: 'invalid_server_consent', status: 502 });
  });
});
