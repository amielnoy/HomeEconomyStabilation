export const ATTRIBUTION_KEY = 'mazan-habait/marketing-attribution';
export const EVENTS_KEY = 'mazan-habait/marketing-events';
const ATTRIBUTION_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid'];
const cleanValue = (value) => value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 240);
export function readAttribution(search) {
    const params = new URLSearchParams(search);
    const attribution = {};
    for (const field of ATTRIBUTION_FIELDS) {
        const value = cleanValue(params.get(field) || '');
        if (value)
            attribution[field] = value;
    }
    return attribution;
}
export function captureMarketingAttribution(search, storage = localStorage, capturedAt = new Date().toISOString()) {
    const attribution = readAttribution(search);
    if (!Object.keys(attribution).length)
        return null;
    let existing = null;
    try {
        existing = JSON.parse(storage.getItem(ATTRIBUTION_KEY) || 'null');
    }
    catch {
        existing = null;
    }
    const touch = { ...attribution, capturedAt };
    const record = { firstTouch: existing?.firstTouch || touch, lastTouch: touch };
    storage.setItem(ATTRIBUTION_KEY, JSON.stringify(record));
    return record;
}
export function trackMarketingEvent(name, details = {}, storage = localStorage, at = new Date().toISOString()) {
    const event = { name: cleanValue(name), at, ...(Object.keys(details).length ? { details } : {}) };
    let events = [];
    try {
        const parsed = JSON.parse(storage.getItem(EVENTS_KEY) || '[]');
        if (Array.isArray(parsed))
            events = parsed;
    }
    catch {
        events = [];
    }
    events.push(event);
    storage.setItem(EVENTS_KEY, JSON.stringify(events.slice(-50)));
    if (typeof window !== 'undefined')
        window.dispatchEvent(new CustomEvent('mazan:marketing', { detail: event }));
    return event;
}
