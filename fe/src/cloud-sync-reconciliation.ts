import type { PrivacySafeSnapshot } from './privacy.js';

export type ReconciliationOutcome = 'none' | 'adopt-cloud' | 'conflict';

/* An empty device has nothing to lose, so a cloud snapshot is adopted outright rather
   than offered as a choice. Anything else that differs is a real conflict: neither side
   is silently preferred, and the caller must ask which copy to keep. */
export function reconcileCloudSnapshot(local: PrivacySafeSnapshot, cloud: PrivacySafeSnapshot | null): ReconciliationOutcome {
  if (!cloud) return 'none';
  if (local.tx.length === 0) return 'adopt-cloud';
  return JSON.stringify(local) === JSON.stringify(cloud) ? 'none' : 'conflict';
}
