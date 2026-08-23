export const SUPPORTED_LOCALES = ['he', 'en', 'am', 'fr'];
export const LOCALE_CONFIG = {
    he: { intl: 'he-IL', dir: 'rtl' },
    en: { intl: 'en-IL', dir: 'ltr' },
    am: { intl: 'am-ET', dir: 'ltr' },
    fr: { intl: 'fr-FR', dir: 'ltr' },
};
export function isSupportedLocale(value) {
    return typeof value === 'string' && SUPPORTED_LOCALES.includes(value);
}
export function resolveLocale(value, fallback = 'he') {
    return isSupportedLocale(value) ? value : fallback;
}
export function getLocaleConfig(locale) {
    return LOCALE_CONFIG[locale];
}
export function formatMessage(template, parameters = {}) {
    return template.replace(/\{(\w+)\}/g, (placeholder, name) => Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : placeholder);
}
export function createLocaleFormatters(locale) {
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
