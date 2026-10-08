import { describe, expect, it, vi } from 'vitest';
import { OpenBankingClient, OpenBankingError } from '../../fe/src/open-banking';

describe('open banking client', () => {
  it('builds the connect href from the source id, no fetch involved', () => {
    const client = new OpenBankingClient({ fetchImpl: vi.fn() as typeof fetch });
    expect(client.connectHref('hapoalim')).toBe('/api/open-banking/connect/hapoalim');
  });

  it('lists sources with the ambient cookie, not an explicit token', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ sources: [{ id: 'hapoalim', name: 'בנק הפועלים', kind: 'bank', mode: 'sandbox' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const client = new OpenBankingClient({ fetchImpl: fetchImpl as typeof fetch });

    const sources = await client.listSources();

    expect(sources).toEqual([{ id: 'hapoalim', name: 'בנק הפועלים', kind: 'bank', mode: 'sandbox' }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/open-banking/sources',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('sends the request with credentials and surfaces a 401 as a stable error', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init?.credentials).toBe('include');
      expect(init?.headers ?? {}).not.toHaveProperty('Authorization');
      return new Response(JSON.stringify({ code: 'authentication_required' }), { status: 401 });
    });
    const client = new OpenBankingClient({ fetchImpl: fetchImpl as typeof fetch });

    await expect(client.listConnections()).rejects.toMatchObject({ code: 'authentication_required', status: 401 });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('syncs with credentials and returns mapped transactions', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('include');
      return new Response(
        JSON.stringify({ transactions: [{ date: '2026-10-04', vdate: '2026-10-04', ref: '', desc: 'Groceries', out: 42, in: 0, bal: null, pending: false, source: 'bank', src: 'open-banking', id: 'txn-1' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const client = new OpenBankingClient({ fetchImpl: fetchImpl as typeof fetch });

    const rows = await client.sync('conn-1');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'txn-1', src: 'open-banking' });
  });

  it('maps a non-OK sync response to a stable error', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 'open_banking_refresh_failed' }), { status: 502 }));
    const client = new OpenBankingClient({ fetchImpl: fetchImpl as typeof fetch });

    await expect(client.sync('conn-1')).rejects.toMatchObject(
      new OpenBankingError('open_banking_refresh_failed', 'Open Banking sync failed.', 502),
    );
  });

  it('disconnects with DELETE, credentials included, and no body', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init).toMatchObject({ method: 'DELETE', credentials: 'include', body: undefined });
      return new Response(null, { status: 204 });
    });
    const client = new OpenBankingClient({ fetchImpl: fetchImpl as typeof fetch });

    await expect(client.disconnect('conn-1')).resolves.toBeUndefined();
  });
});
