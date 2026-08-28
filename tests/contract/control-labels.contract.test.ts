import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

/* The header controls are the narrowest place any translated string has to fit. A label
   that is comfortable in Hebrew can be twice the length in French — "טעינת דוח בנק"
   against "Importer un relevé bancaire" — and the one that overflowed its button on a
   zoomed phone was found by a customer, not by a test. Length is the property that
   matters here, so it is the property asserted. */

const root = resolve(__dirname, '../..');
const locales = ['he', 'en', 'am', 'fr'] as const;
const resources = Object.fromEntries(locales.map((locale) => [
  locale,
  JSON.parse(readFileSync(resolve(root, `resources/${locale}.json`), 'utf8')) as Record<string, string>,
])) as Record<typeof locales[number], Record<string, string>>;

const document = new JSDOM(readFileSync(resolve(root, 'mazan-habait.html'), 'utf8')).window.document;

/* The controls that share the top bar with the overflow toggle, where the width is
   divided rather than given. */
const HEADER_LABEL_KEYS = ['bankUpload', 'cardUpload'] as const;

/* Two labels, a 48px toggle and the gaps have roughly 190px between them on the
   narrowest phone once zoom is taken into account. At 13px this is about the longest
   string that still fits two lines inside a pill. */
const HEADER_LABEL_LIMIT = 34;

describe('control label contract', () => {
  it('translates every header action in every supported locale', () => {
    for (const locale of locales) {
      for (const key of HEADER_LABEL_KEYS) {
        expect(resources[locale][key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });

  it('keeps every header action label short enough to fit its control', () => {
    const tooLong = locales.flatMap((locale) => HEADER_LABEL_KEYS
      .filter((key) => (resources[locale][key] ?? '').length > HEADER_LABEL_LIMIT)
      .map((key) => `${locale}.${key} is ${resources[locale][key]!.length} characters`));

    expect(tooLong).toEqual([]);
  });

  /* Two upload controls sit side by side; if their labels ever read the same, the only
     thing separating them is a small icon. */
  it('keeps the bank and card uploads distinguishable in every locale', () => {
    for (const locale of locales) {
      expect(resources[locale].bankUpload, locale).not.toBe(resources[locale].cardUpload);
    }
  });

  it('resolves every data-i18n key in the markup for every locale', () => {
    const keys = [...document.querySelectorAll('[data-i18n]')]
      .map((node) => node.getAttribute('data-i18n')!)
      .filter(Boolean);

    expect(keys.length).toBeGreaterThan(0);
    for (const locale of locales) {
      const missing = [...new Set(keys)].filter((key) => !(key in resources[locale]));
      expect(missing, `${locale} is missing markup keys`).toEqual([]);
    }
  });

  /* An aria-label that falls back to its own key is what a screen-reader user hears. */
  it('resolves every translated aria-label in the markup for every locale', () => {
    const keys = [...document.querySelectorAll('[data-i18n-aria-label]')]
      .map((node) => node.getAttribute('data-i18n-aria-label')!)
      .filter(Boolean);

    for (const locale of locales) {
      const missing = [...new Set(keys)].filter((key) => !(key in resources[locale]));
      expect(missing, `${locale} is missing aria-label keys`).toEqual([]);
    }
  });

  it('gives both upload controls a label element the layout can constrain', () => {
    for (const testId of ['bank-upload-trigger', 'card-upload-trigger']) {
      const trigger = document.querySelector(`[data-testid="${testId}"]`);
      expect(trigger, testId).not.toBeNull();
      expect(trigger!.querySelector('span[data-i18n]'), `${testId} has no translated span`).not.toBeNull();
    }
  });
});
