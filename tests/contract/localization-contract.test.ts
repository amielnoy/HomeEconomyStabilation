import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const locales = ['he', 'en', 'am', 'fr'] as const;
const readLocale = (locale: string) => JSON.parse(
  readFileSync(resolve(root, `resources/${locale}.json`), 'utf8'),
) as Record<string, unknown>;

describe('localization contract', () => {
  it('provides every canonical resource key in all supported locales', () => {
    const canonicalKeys = Object.keys(readLocale('he')).filter((key) => key !== 'replace').sort();

    for (const locale of locales) {
      const keys = Object.keys(readLocale(locale)).filter((key) => key !== 'replace').sort();
      expect(keys).toEqual(canonicalKeys);
    }
  });

  it('uses the same named parameters for every translated sentence', () => {
    const resources = Object.fromEntries(locales.map((locale) => [locale, readLocale(locale)]));
    const parameterNames = (value: unknown) => typeof value === 'string'
      ? [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
      : [];

    for (const [key, canonicalValue] of Object.entries(resources.he)) {
      if (key === 'replace') continue;
      const expected = parameterNames(canonicalValue);
      for (const locale of locales) {
        expect(parameterNames(resources[locale][key]), `${locale}.${key} has mismatched parameters`)
          .toEqual(expected);
      }
    }
  });

  it('keeps dynamic replacement coverage identical across translated locales', () => {
    const englishReplacementKeys = Object.keys(readLocale('en').replace as Record<string, string>).sort();

    for (const locale of ['am', 'fr'] as const) {
      const replacements = readLocale(locale).replace as Record<string, string>;
      expect(Object.keys(replacements).sort()).toEqual(englishReplacementKeys);
      expect(Object.values(replacements).every((value) => value.trim().length > 0)).toBe(true);
    }
  });

  it('defines every translation key used by page text and accessible attributes', () => {
    const html = readFileSync(resolve(root, 'mazan-habait.html'), 'utf8');
    const usedKeys = [...html.matchAll(/data-i18n(?:-placeholder|-aria-label)?="([^"]+)"/g)]
      .map((match) => match[1]);

    for (const locale of locales) {
      const resource = readLocale(locale);
      for (const key of usedKeys) expect(resource, `${locale} is missing ${key}`).toHaveProperty(key);
    }
  });

  it('defines every literal translation key requested by runtime code', () => {
    const source = readFileSync(resolve(root, 'src/app.ts'), 'utf8');
    const usedKeys = [...source.matchAll(/\bt\('([^']+)'/g)].map((match) => match[1]);

    for (const locale of locales) {
      const resource = readLocale(locale);
      for (const key of usedKeys) expect(resource, `${locale} is missing runtime key ${key}`).toHaveProperty(key);
    }
  });

  it('exposes every supported locale in the language picker using native names', () => {
    const html = readFileSync(resolve(root, 'mazan-habait.html'), 'utf8');

    expect(html).toContain('<option value="he">עברית</option>');
    expect(html).toContain('<option value="en">English</option>');
    expect(html).toContain('<option value="am">አማርኛ</option>');
    expect(html).toContain('<option value="fr">Français</option>');
  });

  it('keeps the household currency in ILS for every language', () => {
    const source = readFileSync(resolve(root, 'src/localization.ts'), 'utf8');

    expect(source).not.toContain("'USD'");
    expect(source.match(/currency: 'ILS'/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
