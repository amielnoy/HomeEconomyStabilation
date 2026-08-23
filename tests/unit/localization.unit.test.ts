import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_LOCALES,
  createLocaleFormatters,
  formatMessage,
  getLocaleConfig,
  isSupportedLocale,
  resolveLocale,
} from '../../src/localization';

describe('localization utilities', () => {
  it('accepts only the four supported locale identifiers', () => {
    expect(SUPPORTED_LOCALES).toEqual(['he', 'en', 'am', 'fr']);
    for (const locale of SUPPORTED_LOCALES) expect(isSupportedLocale(locale)).toBe(true);
    for (const value of ['de', 'he-IL', '', null, undefined, 1]) expect(isSupportedLocale(value)).toBe(false);
  });

  it('falls back safely when a persisted locale is invalid', () => {
    expect(resolveLocale('fr')).toBe('fr');
    expect(resolveLocale('unsupported')).toBe('he');
    expect(resolveLocale(null, 'en')).toBe('en');
  });

  it('maps Hebrew to RTL and the other supported languages to LTR', () => {
    expect(getLocaleConfig('he').dir).toBe('rtl');
    for (const locale of ['en', 'am', 'fr'] as const) {
      expect(getLocaleConfig(locale).dir).toBe('ltr');
    }
  });

  it.each(SUPPORTED_LOCALES)('always formats money as ILS in %s', (locale) => {
    const { money0, money2Signed } = createLocaleFormatters(locale);

    expect(money0.resolvedOptions().currency).toBe('ILS');
    expect(money2Signed.resolvedOptions().currency).toBe('ILS');
    expect(money2Signed.formatToParts(12.5).some((part) => part.type === 'plusSign')).toBe(true);
  });

  it('uses UTC for stable calendar dates in every locale', () => {
    const date = new Date('2026-08-23T23:30:00Z');

    for (const locale of SUPPORTED_LOCALES) {
      expect(createLocaleFormatters(locale).shortDate.resolvedOptions().timeZone).toBe('UTC');
      expect(createLocaleFormatters(locale).shortDate.format(date)).toBeTruthy();
    }
  });

  it('interpolates named parameters without depending on sentence order', () => {
    expect(formatMessage('{count} items cost {amount}', { count: 3, amount: '₪120' }))
      .toBe('3 items cost ₪120');
    expect(formatMessage('እስከ {date}፦ {amount}', { amount: '₪120', date: '23/08/2026' }))
      .toBe('እስከ 23/08/2026፦ ₪120');
  });

  it('supports zero, repeated parameters and preserves missing placeholders', () => {
    expect(formatMessage('{count}/{count}: {amount} {missing}', { count: 0, amount: '' }))
      .toBe('0/0:  {missing}');
  });
});
