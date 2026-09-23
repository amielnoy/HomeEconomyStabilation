export const ATTRIBUTION_KEY = 'mazan-habait/marketing-attribution';
export const EVENTS_KEY = 'mazan-habait/marketing-events';

const ATTRIBUTION_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid'] as const;
export type AttributionField = typeof ATTRIBUTION_FIELDS[number];
export type Attribution = Partial<Record<AttributionField, string>>;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface AttributionRecord {
  firstTouch: Attribution & { capturedAt: string };
  lastTouch: Attribution & { capturedAt: string };
}

export interface MarketingEvent {
  name: string;
  at: string;
  details?: Record<string, string | number | boolean>;
}

const cleanValue = (value: string): string => value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 240);

export function readAttribution(search: string): Attribution {
  const params = new URLSearchParams(search);
  const attribution: Attribution = {};
  for (const field of ATTRIBUTION_FIELDS) {
    const value = cleanValue(params.get(field) || '');
    if (value) attribution[field] = value;
  }
  return attribution;
}

export function captureMarketingAttribution(
  search: string,
  storage: StorageLike = localStorage,
  capturedAt = new Date().toISOString(),
): AttributionRecord | null {
  const attribution = readAttribution(search);
  if (!Object.keys(attribution).length) return null;
  let existing: AttributionRecord | null = null;
  try { existing = JSON.parse(storage.getItem(ATTRIBUTION_KEY) || 'null') as AttributionRecord | null; }
  catch { existing = null; }
  const touch = { ...attribution, capturedAt };
  const record = { firstTouch: existing?.firstTouch || touch, lastTouch: touch };
  storage.setItem(ATTRIBUTION_KEY, JSON.stringify(record));
  return record;
}

export function trackMarketingEvent(
  name: string,
  details: MarketingEvent['details'] = {},
  storage: StorageLike = localStorage,
  at = new Date().toISOString(),
): MarketingEvent {
  const event: MarketingEvent = { name: cleanValue(name), at, ...(Object.keys(details).length ? { details } : {}) };
  let events: MarketingEvent[] = [];
  try {
    const parsed = JSON.parse(storage.getItem(EVENTS_KEY) || '[]');
    if (Array.isArray(parsed)) events = parsed;
  } catch { events = []; }
  events.push(event);
  storage.setItem(EVENTS_KEY, JSON.stringify(events.slice(-50)));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mazan:marketing', { detail: event }));
  return event;
}
