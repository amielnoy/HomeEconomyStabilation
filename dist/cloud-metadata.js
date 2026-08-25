import { CLOUD_CONSENT_VERSION } from './consent.js';
import { CloudSyncError } from './cloud-sync.js';
import { HttpStatus } from './http-status.js';
import { isSupportedLocale } from './localization.js';
class AuthenticatedJsonClient {
    input;
    constructor(input) {
        this.input = input;
    }
    async request(endpoint, method, payload) {
        const token = await this.input.accessToken();
        if (!token)
            throw new CloudSyncError('authentication_required', 'Sign in before using cloud sync.', HttpStatus.UNAUTHORIZED);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.input.timeoutMs ?? 10_000);
        let response;
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
        }
        catch {
            if (controller.signal.aborted)
                throw new CloudSyncError('cloud_timeout', 'Cloud request timed out.', HttpStatus.GATEWAY_TIMEOUT);
            throw new CloudSyncError('cloud_network_failed', 'Cloud data is currently unavailable.');
        }
        finally {
            clearTimeout(timeout);
        }
        const body = response.status === HttpStatus.NO_CONTENT
            ? null
            : await response.json().catch(() => null);
        if (!response.ok) {
            const code = typeof body?.code === 'string' ? body.code : 'cloud_request_failed';
            throw new CloudSyncError(code, 'Cloud data is currently unavailable.', response.status);
        }
        return body;
    }
}
const isDateTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
function parseProfile(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const profile = value;
    if (!isSupportedLocale(profile.preferredLocale) || !isDateTime(profile.createdAt) || !isDateTime(profile.updatedAt))
        return null;
    return profile;
}
function parseConsent(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const consent = value;
    if (consent.purpose !== 'cloud_sync' || consent.statementVersion !== CLOUD_CONSENT_VERSION
        || !isSupportedLocale(consent.locale) || !isDateTime(consent.acceptedAt)
        || !(consent.withdrawnAt === null || isDateTime(consent.withdrawnAt)))
        return null;
    return consent;
}
export class SupabaseProfileRepository {
    client;
    endpoint;
    constructor(input) {
        this.client = new AuthenticatedJsonClient(input);
        this.endpoint = input.endpoint || '/api/profile';
    }
    async load() {
        const profile = (await this.client.request(this.endpoint, 'GET'))?.profile;
        if (profile === null || profile === undefined)
            return null;
        const parsed = parseProfile(profile);
        if (!parsed)
            throw new CloudSyncError('invalid_server_profile', 'The cloud profile format is not supported.', HttpStatus.BAD_GATEWAY);
        return parsed;
    }
    async save(preferredLocale) {
        const profile = (await this.client.request(this.endpoint, 'PUT', { preferredLocale }))?.profile;
        const parsed = parseProfile(profile);
        if (!parsed)
            throw new CloudSyncError('invalid_server_profile', 'The cloud profile format is not supported.', HttpStatus.BAD_GATEWAY);
        return parsed;
    }
}
export class SupabaseConsentRepository {
    client;
    endpoint;
    constructor(input) {
        this.client = new AuthenticatedJsonClient(input);
        this.endpoint = input.endpoint || '/api/consents/cloud-sync';
    }
    async current() {
        const consent = (await this.client.request(this.endpoint, 'GET'))?.consent;
        if (consent === null || consent === undefined)
            return null;
        const parsed = parseConsent(consent);
        if (!parsed)
            throw new CloudSyncError('invalid_server_consent', 'The cloud consent format is not supported.', HttpStatus.BAD_GATEWAY);
        return parsed;
    }
    async accept(locale) {
        const consent = (await this.client.request(this.endpoint, 'PUT', { locale }))?.consent;
        const parsed = parseConsent(consent);
        if (!parsed)
            throw new CloudSyncError('invalid_server_consent', 'The cloud consent format is not supported.', HttpStatus.BAD_GATEWAY);
        return parsed;
    }
    async withdraw() { await this.client.request(this.endpoint, 'DELETE'); }
}
