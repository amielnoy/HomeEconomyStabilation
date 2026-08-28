import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_LOCALES,
  createLocaleFormatters,
  formatMessage,
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

  /* A file name and a column list both come from a file the customer was given, so the
     substitution has to take arbitrary text without losing or mangling any of it. */
  it('substitutes arbitrary parameter text without dropping any of it', () => {
    const rendered = formatMessage('לא זוהו עמודות ב{file}. נמצאו: {columns}', {
      file: 'דוח-כרטיס (אוגוסט) #2.xls',
      columns: 'תאריך · שם בית העסק · סכום',
    });

    expect(rendered).toBe('לא זוהו עמודות בדוח-כרטיס (אוגוסט) #2.xls. נמצאו: תאריך · שם בית העסק · סכום');
  });

  /* A parameter the caller forgot has to stay visible as a defect rather than turning
     the sentence into a lie about the customer's money. */
  it('leaves an unsupplied parameter in place rather than rendering it as empty', () => {
    expect(formatMessage('{count} תנועות נוספו', {})).toContain('{count}');
  });

  it('rejects an unknown locale by falling back to the default rather than throwing', () => {
    for (const value of ['de', '', null, undefined, 42, {}]) {
      expect(SUPPORTED_LOCALES).toContain(resolveLocale(value));
    }
  });
});
