/* Local-first is the product's promise, so the browser store is authoritative:
   a cloud store, once wired, mirrors it rather than replacing it. Withdrawal has to
   work with no network, which only the local side can guarantee. */
export const CLOUD_CONSENT_KEY = 'mazan-habait/cloud-consent';
export const CLOUD_CONSENT_VERSION = 'cloud-sync-v2-privacy-minimised-2026-08-24';
/* Its own purpose, its own storage key: a household can consent to one without the
   other, and withdrawing open-banking access must never read as withdrawing cloud
   sync. The version string must match the server's OPEN_BANKING_CONSENT_VERSION
   exactly (server/open_banking_routes.py) — the two are not derived from one shared
   source, so a bump on one side needs the other updated by hand. */
export const OPEN_BANKING_CONSENT_KEY = 'mazan-habait/consent/open-banking';
export const OPEN_BANKING_CONSENT_VERSION = 'open-banking-v1-read-only-2026-10-07';

export type ConsentPurpose = 'cloud_sync' | 'open_banking';

const STORAGE_KEY: Record<ConsentPurpose, string> = {
  cloud_sync: CLOUD_CONSENT_KEY,
  open_banking: OPEN_BANKING_CONSENT_KEY,
};
const STATEMENT_VERSION: Record<ConsentPurpose, string> = {
  cloud_sync: CLOUD_CONSENT_VERSION,
  open_banking: OPEN_BANKING_CONSENT_VERSION,
};

export interface ConsentAcceptance {
  purpose: ConsentPurpose;
  statementVersion: string;
  acceptedAt: string;
  locale: string;
}

interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The one shape a consent store has to satisfy, whichever side of the network it
 * lives on. Two implementations already exist — this browser one and the Supabase
 * repository in cloud-metadata.ts — and naming the port now settles which is
 * authoritative before the choice becomes a migration.
 *
 * `current()` is deliberately allowed to be async so a remote store fits without
 * the callers changing shape.
 */
export interface ConsentPort {
  current(): ConsentAcceptance | null | Promise<ConsentAcceptance | null>;
  accept(locale: string): ConsentAcceptance | Promise<ConsentAcceptance>;
  withdraw(): void | Promise<void>;
}

export class LocalConsentRepository implements ConsentPort {
  constructor(private readonly storage: StoragePort, private readonly purpose: ConsentPurpose = 'cloud_sync') {}

  current(): ConsentAcceptance | null {
    try {
      const value = JSON.parse(this.storage.getItem(STORAGE_KEY[this.purpose]) || 'null') as ConsentAcceptance | null;
      return value?.purpose === this.purpose && value.statementVersion === STATEMENT_VERSION[this.purpose]
        && typeof value.acceptedAt === 'string' && typeof value.locale === 'string' ? value : null;
    } catch {
      return null;
    }
  }

  accept(locale: string, now = new Date()): ConsentAcceptance {
    const acceptance: ConsentAcceptance = {
      purpose: this.purpose, statementVersion: STATEMENT_VERSION[this.purpose],
      acceptedAt: now.toISOString(), locale,
    };
    this.storage.setItem(STORAGE_KEY[this.purpose], JSON.stringify(acceptance));
    return acceptance;
  }

  withdraw(): void { this.storage.removeItem(STORAGE_KEY[this.purpose]); }
}
