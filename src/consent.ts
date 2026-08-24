export const CLOUD_CONSENT_KEY = 'mazan-habait/cloud-consent';
export const CLOUD_CONSENT_VERSION = 'cloud-sync-v2-privacy-minimised-2026-08-24';

export interface ConsentAcceptance {
  purpose: 'cloud_sync';
  statementVersion: typeof CLOUD_CONSENT_VERSION;
  acceptedAt: string;
  locale: string;
}

interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class LocalConsentRepository {
  constructor(private readonly storage: StoragePort) {}

  current(): ConsentAcceptance | null {
    try {
      const value = JSON.parse(this.storage.getItem(CLOUD_CONSENT_KEY) || 'null') as ConsentAcceptance | null;
      return value?.purpose === 'cloud_sync' && value.statementVersion === CLOUD_CONSENT_VERSION
        && typeof value.acceptedAt === 'string' && typeof value.locale === 'string' ? value : null;
    } catch {
      return null;
    }
  }

  accept(locale: string, now = new Date()): ConsentAcceptance {
    const acceptance: ConsentAcceptance = {
      purpose: 'cloud_sync', statementVersion: CLOUD_CONSENT_VERSION,
      acceptedAt: now.toISOString(), locale,
    };
    this.storage.setItem(CLOUD_CONSENT_KEY, JSON.stringify(acceptance));
    return acceptance;
  }

  withdraw(): void { this.storage.removeItem(CLOUD_CONSENT_KEY); }
}
