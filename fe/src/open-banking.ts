import { HttpStatus } from './http-status.js';
import type { BankTransaction } from './domain-model.js';

export interface OpenBankingSourceInfo {
  id: string;
  name: string;
  kind: 'bank' | 'card_issuer';
  mode: 'sandbox' | 'production' | 'unavailable';
}

export interface OpenBankingConnectionInfo {
  id: string;
  sourceId: string;
  status: 'active' | 'revoked';
  createdAt: string;
}

export class OpenBankingError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 0) {
    super(message);
    this.name = 'OpenBankingError';
  }
}

export class OpenBankingClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly input: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
    this.fetchImpl = input.fetchImpl || fetch;
  }

  connectHref(sourceId: string): string {
    return `/api/open-banking/connect/${encodeURIComponent(sourceId)}`;
  }

  private async request(method: 'GET' | 'POST' | 'DELETE', path: string): Promise<Record<string, unknown> | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.input.timeoutMs ?? 10_000);
    let response: Response;
    try {
      response = await this.fetchImpl(path, { method, credentials: 'include', signal: controller.signal, body: undefined });
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new OpenBankingError('open_banking_timeout', 'Open Banking request timed out.', HttpStatus.GATEWAY_TIMEOUT);
      }
      throw new OpenBankingError('open_banking_network_failed', 'Open Banking is currently unavailable.');
    } finally {
      clearTimeout(timeout);
    }
    const body = response.status === HttpStatus.NO_CONTENT ? null : await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const code = typeof body?.code === 'string' ? body.code : 'open_banking_request_failed';
      throw new OpenBankingError(code, 'Open Banking sync failed.', response.status);
    }
    return body;
  }

  async listSources(): Promise<OpenBankingSourceInfo[]> {
    const body = await this.request('GET', '/api/open-banking/sources');
    return (body?.sources as OpenBankingSourceInfo[] | undefined) ?? [];
  }

  async listConnections(): Promise<OpenBankingConnectionInfo[]> {
    const body = await this.request('GET', '/api/open-banking/connections');
    return (body?.connections as OpenBankingConnectionInfo[] | undefined) ?? [];
  }

  async sync(connectionId: string): Promise<BankTransaction[]> {
    const body = await this.request('POST', `/api/open-banking/sync/${encodeURIComponent(connectionId)}`);
    return (body?.transactions as BankTransaction[] | undefined) ?? [];
  }

  async disconnect(connectionId: string): Promise<void> {
    await this.request('DELETE', `/api/open-banking/connections/${encodeURIComponent(connectionId)}`);
  }
}
