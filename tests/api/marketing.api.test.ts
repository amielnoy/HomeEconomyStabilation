import { describe, expect, it } from 'vitest';
import { captureMarketingAttribution, readAttribution, trackMarketingEvent } from '../../src/marketing';

describe('marketing public API', () => {
  it('returns a predictable attribution payload for analytics adapters', () => {
    expect(readAttribution('?utm_source=google&utm_medium=cpc&utm_campaign=family-budget')).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'family-budget',
    });
  });

  it('exports callable capture and event functions', () => {
    expect(captureMarketingAttribution).toEqual(expect.any(Function));
    expect(trackMarketingEvent).toEqual(expect.any(Function));
  });
});
