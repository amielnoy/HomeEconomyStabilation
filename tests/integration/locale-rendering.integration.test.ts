import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { formatMessage, getLocaleConfig, resolveLocale, SUPPORTED_LOCALES } from '../../src/localization';

/* The markup declares which nodes are translated, the resource files hold the strings and
   the localization module joins them. Each has its own tests; what none of them covers is
   the join — a key present in the resources but absent from the markup, or a node the
   translator never reaches, shows up only when the two are applied to each other. */

const root = resolve(__dirname, '../..');
const html = readFileSync(resolve(root, 'mazan-habait.html'), 'utf8');
const resources = Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [
  locale,
  JSON.parse(readFileSync(resolve(root, `resources/${locale}.json`), 'utf8')) as Record<string, string>,
]));

/* The same substitution the application performs when it applies a locale. */
function translate(document: Document, locale: string): string[] {
  const untranslated: string[] = [];
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset.i18n!;
    const value = resources[locale]![key];
    if (value === undefined) { untranslated.push(key); continue; }
    node.textContent = value;
  }
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
    const key = node.dataset.i18nAriaLabel!;
    const value = resources[locale]![key];
    if (value === undefined) { untranslated.push(key); continue; }
    node.setAttribute('aria-label', value);
  }
  return untranslated;
}

describe('locale rendering across the markup and the resource files', () => {
  it('fills every translated node in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const document = new JSDOM(html).window.document;

      expect(translate(document, locale), `${locale} left keys unresolved`).toEqual([]);

      const empty = [...document.querySelectorAll<HTMLElement>('[data-i18n]')]
        .filter((node) => (node.textContent ?? '').trim() === '')
        .map((node) => node.dataset.i18n);
      expect(empty, `${locale} rendered empty labels`).toEqual([]);
    }
  });

  it('never leaves a resource key showing where a sentence belongs', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const document = new JSDOM(html).window.document;
      translate(document, locale);

      const leaked = [...document.querySelectorAll<HTMLElement>('[data-i18n]')]
        .filter((node) => node.textContent === node.dataset.i18n)
        .map((node) => node.dataset.i18n);
      expect(leaked, `${locale} shows raw keys`).toEqual([]);
    }
  });

  it('pairs every locale with the writing direction its config declares', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const config = getLocaleConfig(locale);
      expect(['rtl', 'ltr']).toContain(config.dir);
      expect(resolveLocale(locale)).toBe(locale);
    }
    expect(getLocaleConfig('he').dir).toBe('rtl');
    expect(getLocaleConfig('en').dir).toBe('ltr');
  });

  /* The import failures name a file and a column list, both attacker-influenced and both
     substituted into a translated sentence in every locale. */
  it('substitutes import failure parameters in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const template = resources[locale]!.fileColumnsUnrecognized!;
      const rendered = formatMessage(template, { file: 'card.xls', columns: 'תאריך · סכום' });

      expect(rendered).toContain('card.xls');
      expect(rendered).toContain('תאריך · סכום');
      expect(rendered, `${locale} left a placeholder unfilled`).not.toMatch(/\{\w+\}/);
    }
  });

  /* A control the header has to fit is the one place a long translation does damage, so
     the rendered markup — not just the resource file — is what gets measured. */
  it('keeps the rendered header labels within the width the layout reserves', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const document = new JSDOM(html).window.document;
      translate(document, locale);

      for (const testId of ['bank-upload-trigger', 'card-upload-trigger']) {
        const label = document.querySelector(`[data-testid="${testId}"] span[data-i18n]`)!;
        expect((label.textContent ?? '').length, `${locale} ${testId}`).toBeLessThanOrEqual(34);
      }
    }
  });
});
