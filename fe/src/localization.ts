export const SUPPORTED_LOCALES = ['he', 'en', 'am', 'fr'] as const;

export type Locale = typeof SUPPORTED_LOCALES[number];

export interface LocaleConfig {
  intl: string;
  dir: 'ltr' | 'rtl';
}

export const LOCALE_CONFIG: Readonly<Record<Locale, LocaleConfig>> = {
  he: { intl: 'he-IL', dir: 'rtl' },
  en: { intl: 'en-IL', dir: 'ltr' },
  am: { intl: 'am-ET', dir: 'ltr' },
  fr: { intl: 'fr-FR', dir: 'ltr' },
};

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as Locale);
}

export function resolveLocale(value: unknown, fallback: Locale = 'he'): Locale {
  return isSupportedLocale(value) ? value : fallback;
}

export function getLocaleConfig(locale: Locale): LocaleConfig {
  return LOCALE_CONFIG[locale];
}

export type MessageParameters = Readonly<Record<string, string | number>>;

export function formatMessage(template: string, parameters: MessageParameters = {}): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : placeholder,
  );
}

export function createLocaleFormatters(locale: Locale) {
  const { intl } = getLocaleConfig(locale);
  return {
    money0: new Intl.NumberFormat(intl, { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }),
    money2: new Intl.NumberFormat(intl, { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    number0: new Intl.NumberFormat(intl, { maximumFractionDigits: 0 }),
    money0Signed: new Intl.NumberFormat(intl, { style: 'currency', currency: 'ILS', signDisplay: 'always', maximumFractionDigits: 0 }),
    money2Signed: new Intl.NumberFormat(intl, { style: 'currency', currency: 'ILS', signDisplay: 'always', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    dayMonth: new Intl.DateTimeFormat(intl, { day: '2-digit', month: '2-digit', timeZone: 'UTC' }),
    shortDate: new Intl.DateTimeFormat(intl, { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' }),
    longMonth: new Intl.DateTimeFormat(intl, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    shortMonth: new Intl.DateTimeFormat(intl, { month: 'short', timeZone: 'UTC' }),
  };
}
