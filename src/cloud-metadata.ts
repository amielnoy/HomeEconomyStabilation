import { CLOUD_CONSENT_VERSION } from './consent.js';
import { CloudSyncError } from './cloud-sync.js';
import { HttpStatus } from './http-status.js';
import { isSupportedLocale, type Locale } from './localization.js';

export interface CloudProfile {
  preferredLocale: Locale;
  createdAt: string;
  updatedAt: string;
}

export interface CloudConsent {
  purpose: 'cloud_sync';
  statementVersion: typeof CLOUD_CONSENT_VERSION;
  locale: Locale;
  acceptedAt: string;
  withdrawnAt: string | null;
}

type TokenProvider = () => Promise<string | null>;

class AuthenticatedJsonClient {
  constructor(private readonly input: {
    accessToken: TokenProvider;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {}

  async request(endpoint: string, method: 'GET' | 'PUT' | 'DELETE', payload?: object): Promise<Record<string, unknown> | null> {
    const token = await this.input.accessToken();
    if (!token) throw new CloudSyncError('authentication_required', 'Sign in before using cloud sync.', HttpStatus.UNAUTHORIZED);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.input.timeoutMs ?? 10_000);
    let response: Response;
    try {
      response = await (this.input.fetchImpl || fetch)(endpoint, {
        method,
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
        },
        body: payload ? JSON.stringify(payload) : undefined,
      });
    } catch {
      if (controller.signal.aborted) throw new CloudSyncError('cloud_timeout', 'Cloud request timed out.', HttpStatus.GATEWAY_TIMEOUT);
      throw new CloudSyncError('cloud_network_failed', 'Cloud data is currently unavailable.');
    } finally {
      clearTimeout(timeout);
    }
    const body = response.status === HttpStatus.NO_CONTENT
      ? null
      : await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const code = typeof body?.code === 'string' ? body.code : 'cloud_request_failed';
      throw new CloudSyncError(code, 'Cloud data is currently unavailable.', response.status);
    }
    return body;
  }
}

const isDateTime = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

function parseProfile(value: unknown): CloudProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const profile = value as Record<string, unknown>;
  if (!isSupportedLocale(profile.preferredLocale) || !isDateTime(profile.createdAt) || !isDateTime(profile.updatedAt)) return null;
  return profile as unknown as CloudProfile;
}

function parseConsent(value: unknown): CloudConsent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const consent = value as Record<string, unknown>;
  if (consent.purpose !== 'cloud_sync' || consent.statementVersion !== CLOUD_CONSENT_VERSION
      || !isSupportedLocale(consent.locale) || !isDateTime(consent.acceptedAt)
      || !(consent.withdrawnAt === null || isDateTime(consent.withdrawnAt))) return null;
  return consent as unknown as CloudConsent;
}

export class SupabaseProfileRepository {
  private readonly client: AuthenticatedJsonClient;
  private readonly endpoint: string;

  constructor(input: { accessToken: TokenProvider; endpoint?: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
    this.client = new AuthenticatedJsonClient(input);
    this.endpoint = input.endpoint || '/api/profile';
  }

  async load(): Promise<CloudProfile | null> {
    const profile = (await this.client.request(this.endpoint, 'GET'))?.profile;
    if (profile === null || profile === undefined) return null;
    const parsed = parseProfile(profile);
    if (!parsed) throw new CloudSyncError('invalid_server_profile', 'The cloud profile format is not supported.', HttpStatus.BAD_GATEWAY);
    return parsed;
  }

  async save(preferredLocale: Locale): Promise<CloudProfile> {
    const profile = (await this.client.request(this.endpoint, 'PUT', { preferredLocale }))?.profile;
    const parsed = parseProfile(profile);
    if (!parsed) throw new CloudSyncError('invalid_server_profile', 'The cloud profile format is not supported.', HttpStatus.BAD_GATEWAY);
    return parsed;
  }
}

export class SupabaseConsentRepository {
  private readonly client: AuthenticatedJsonClient;
  private readonly endpoint: string;

  constructor(input: { accessToken: TokenProvider; endpoint?: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
    this.client = new AuthenticatedJsonClient(input);
    this.endpoint = input.endpoint || '/api/consents/cloud-sync';
  }

  async current(): Promise<CloudConsent | null> {
    const consent = (await this.client.request(this.endpoint, 'GET'))?.consent;
    if (consent === null || consent === undefined) return null;
    const parsed = parseConsent(consent);
    if (!parsed) throw new CloudSyncError('invalid_server_consent', 'The cloud consent format is not supported.', HttpStatus.BAD_GATEWAY);
    return parsed;
  }

  async accept(locale: Locale): Promise<CloudConsent> {
    const consent = (await this.client.request(this.endpoint, 'PUT', { locale }))?.consent;
    const parsed = parseConsent(consent);
    if (!parsed) throw new CloudSyncError('invalid_server_consent', 'The cloud consent format is not supported.', HttpStatus.BAD_GATEWAY);
    return parsed;
  }

  async withdraw(): Promise<void> { await this.client.request(this.endpoint, 'DELETE'); }
}
