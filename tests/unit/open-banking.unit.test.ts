import { describe, expect, it, vi } from 'vitest';
import { OpenBankingClient, OpenBankingError } from '../../fe/src/open-banking';

describe('open banking client', () => {
  it('builds the connect href from the source id, no fetch involved', () => {
    const client = new OpenBankingClient({ accessToken: async () => 'token', fetchImpl: vi.fn() as typeof fetch });
    expect(client.connectHref('hapoalim')).toBe('/api/open-banking/connect/hapoalim');
  });

  it('lists sources without requiring a signed-in session', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ sources: [{ id: 'hapoalim', name: 'בנק הפועלים', kind: 'bank', mode: 'sandbox' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const client = new OpenBankingClient({ accessToken: async () => null, fetchImpl: fetchImpl as typeof fetch });

    const sources = await client.listSources();

    expect(sources).toEqual([{ id: 'hapoalim', name: 'בנק הפועלים', kind: 'bank', mode: 'sandbox' }]);
    expect(fetchImpl).toHaveBeenCalledWith('/api/open-banking/sources', expect.objectContaining({ method: 'GET' }));
  });

  it('fails before a request when listing connections signed out', async () => {
    const fetchImpl = vi.fn();
    const client = new OpenBankingClient({ accessToken: async () => null, fetchImpl });

    await expect(client.listConnections()).rejects.toMatchObject({ code: 'authentication_required', status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the bearer token and returns mapped transactions on sync', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer user.jwt.token' });
      return new Response(
        JSON.stringify({ transactions: [{ date: '2026-10-04', vdate: '2026-10-04', ref: '', desc: 'Groceries', out: 42, in: 0, bal: null, pending: false, source: 'bank', src: 'open-banking', id: 'txn-1' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const client = new OpenBankingClient({ accessToken: async () => 'user.jwt.token', fetchImpl: fetchImpl as typeof fetch });

    const rows = await client.sync('conn-1');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'txn-1', src: 'open-banking' });
  });

  it('maps a non-OK sync response to a stable error', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 'open_banking_refresh_failed' }), { status: 502 }));
    const client = new OpenBankingClient({ accessToken: async () => 'token', fetchImpl: fetchImpl as typeof fetch });

    await expect(client.sync('conn-1')).rejects.toMatchObject(
      new OpenBankingError('open_banking_refresh_failed', 'Open Banking sync failed.', 502),
    );
  });

  it('disconnects with DELETE and no body', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init).toMatchObject({ method: 'DELETE', body: undefined });
      return new Response(null, { status: 204 });
    });
    const client = new OpenBankingClient({ accessToken: async () => 'token', fetchImpl: fetchImpl as typeof fetch });

    await expect(client.disconnect('conn-1')).resolves.toBeUndefined();
  });
});
