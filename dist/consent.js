export const CLOUD_CONSENT_KEY = 'mazan-habait/cloud-consent';
export const CLOUD_CONSENT_VERSION = 'cloud-sync-v2-privacy-minimised-2026-08-24';
export class LocalConsentRepository {
    storage;
    constructor(storage) {
        this.storage = storage;
    }
    current() {
        try {
            const value = JSON.parse(this.storage.getItem(CLOUD_CONSENT_KEY) || 'null');
            return value?.purpose === 'cloud_sync' && value.statementVersion === CLOUD_CONSENT_VERSION
                && typeof value.acceptedAt === 'string' && typeof value.locale === 'string' ? value : null;
        }
        catch {
            return null;
        }
    }
    accept(locale, now = new Date()) {
        const acceptance = {
            purpose: 'cloud_sync', statementVersion: CLOUD_CONSENT_VERSION,
            acceptedAt: now.toISOString(), locale,
        };
        this.storage.setItem(CLOUD_CONSENT_KEY, JSON.stringify(acceptance));
        return acceptance;
    }
    withdraw() { this.storage.removeItem(CLOUD_CONSENT_KEY); }
}
