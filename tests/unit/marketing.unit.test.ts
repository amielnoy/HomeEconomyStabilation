import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_KEY,
  EVENTS_KEY,
  captureMarketingAttribution,
  readAttribution,
  trackMarketingEvent,
} from '../../src/marketing';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
};

describe('marketing utilities', () => {
  it('reads only supported attribution parameters', () => {
    expect(readAttribution('?utm_source=google&utm_medium=cpc&unknown=ignored&gclid=abc')).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      gclid: 'abc',
    });
  });

  it('preserves first touch while updating last touch', () => {
    const storage = memoryStorage();
    captureMarketingAttribution('?utm_source=google&utm_campaign=launch', storage, '2026-08-01T00:00:00.000Z');
    const record = captureMarketingAttribution('?utm_source=newsletter', storage, '2026-08-02T00:00:00.000Z');

    expect(record?.firstTouch).toMatchObject({ utm_source: 'google', utm_campaign: 'launch' });
    expect(record?.lastTouch).toMatchObject({ utm_source: 'newsletter' });
    expect(JSON.parse(storage.getItem(ATTRIBUTION_KEY)!)).toEqual(record);
  });

  it('does not write an attribution record without campaign parameters', () => {
    const storage = memoryStorage();

    expect(captureMarketingAttribution('?ordinary=value', storage)).toBeNull();
    expect(storage.getItem(ATTRIBUTION_KEY)).toBeNull();
  });

  it('keeps only the 50 most recent marketing events', () => {
    const storage = memoryStorage();
    for (let index = 0; index < 55; index++) {
      trackMarketingEvent(`event-${index}`, { index }, storage, `2026-08-23T00:00:${String(index).padStart(2, '0')}.000Z`);
    }
    const events = JSON.parse(storage.getItem(EVENTS_KEY)!) as Array<{ name: string }>;

    expect(events).toHaveLength(50);
    expect(events[0].name).toBe('event-5');
    expect(events[49].name).toBe('event-54');
  });
});
