import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_LOCALES,
  createLocaleFormatters,
  getLocaleConfig,
  resolveLocale,
} from '../../src/localization';

describe('localization public API', () => {
  it('exposes stable config for every advertised locale', () => {
    const response = Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [locale, getLocaleConfig(locale)]),
    );

    expect(response).toEqual({
      he: { intl: 'he-IL', dir: 'rtl' },
      en: { intl: 'en-IL', dir: 'ltr' },
      am: { intl: 'am-ET', dir: 'ltr' },
      fr: { intl: 'fr-FR', dir: 'ltr' },
    });
  });

  it('returns a complete formatter set through the public factory', () => {
    const formatters = createLocaleFormatters(resolveLocale('fr'));

    expect(Object.keys(formatters).sort()).toEqual([
      'dayMonth', 'longMonth', 'money0', 'money0Signed', 'money2',
      'money2Signed', 'number0', 'shortDate', 'shortMonth',
    ].sort());
    expect(formatters.money0.format(1234)).toContain('₪');
  });
});
