import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const locales = ['he', 'en', 'am', 'fr'] as const;
const readLocale = (locale: string) => JSON.parse(
  readFileSync(resolve(root, `fe/resources/${locale}.json`), 'utf8'),
) as Record<string, unknown>;

const decode = (value: string) => value
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&nbsp;/g, '\u00a0').replace(/&amp;/g, '&');

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
    const html = readFileSync(resolve(root, 'fe/mazan-habait.html'), 'utf8');
    const usedKeys = [...html.matchAll(/data-i18n(?:-placeholder|-aria-label)?="([^"]+)"/g)]
      .map((match) => match[1]);

    for (const locale of locales) {
      const resource = readLocale(locale);
      for (const key of usedKeys) expect(resource, `${locale} is missing ${key}`).toHaveProperty(key);
    }
  });

  it('defines every literal translation key requested by runtime code', () => {
    const source = readFileSync(resolve(root, 'fe/src/app.ts'), 'utf8');
    const usedKeys = [...source.matchAll(/\bt\('([^']+)'/g)].map((match) => match[1]);

    for (const locale of locales) {
      const resource = readLocale(locale);
      for (const key of usedKeys) expect(resource, `${locale} is missing runtime key ${key}`).toHaveProperty(key);
    }
  });

  it('exposes every supported locale in the language picker using native names', () => {
    const html = readFileSync(resolve(root, 'fe/mazan-habait.html'), 'utf8');

    expect(html).toContain('<option value="he">עברית</option>');
    expect(html).toContain('<option value="en">English</option>');
    expect(html).toContain('<option value="am">አማርኛ</option>');
    expect(html).toContain('<option value="fr">Français</option>');
  });

  /* The directory names a real person and links to their site. Whatever the card calls the
     profession, every language has to carry the sentence that says a listing is not vetting
     — a described role reads as endorsement if nothing next to it says otherwise. */
  it('describes the listed advisor and refuses to imply an endorsement in every language', () => {
    const role = {
      he: 'יועצת פנסיונית ופיננסית', en: 'pension and financial advisor',
      fr: 'conseillère en retraite et en finances', am: 'የጡረታና የፋይናንስ አማካሪ',
    } as const;
    const notAnEndorsement = {
      he: 'אינה המלצה או אימות עצמאות', en: 'not a recommendation or verification of independence',
      fr: 'ni une recommandation ni une vérification de son indépendance',
      am: 'ምክር ወይም የገለልተኝነት ማረጋገጫ አይደለም',
    } as const;

    for (const locale of locales) {
      const description = readLocale(locale).doritGovAriDescription;
      expect(description, `${locale} is missing the advisor description`).toBeTypeOf('string');
      expect(description as string, `${locale} does not name the role`).toContain(role[locale]);
      expect(description as string, `${locale} dropped the disclaimer`).toContain(notAnEndorsement[locale]);
    }
  });

  /* Hebrew copy lives twice: in he.json, and inline in the HTML as the text the page shows
     before a locale is applied. An edit to one and not the other is invisible — the page
     looks right the moment it is translated — so the two are pinned to each other here. */
  it('keeps the Hebrew text in the page identical to the Hebrew resource', () => {
    const html = readFileSync(resolve(root, 'fe/mazan-habait.html'), 'utf8');
    const hebrew = readLocale('he');
    /* Two entries drifted before this test existed and are quarantined rather than
       silently corrected: which side is right is a copy decision, not a test's to make. */
    const knownDrift = ['importStep2', 'companiesNote'];

    const drifted: string[] = [];
    for (const match of html.matchAll(/<(\w+)[^>]*\bdata-i18n="([\w.]+)"[^>]*>([^<]*)<\/\1>/g)) {
      const [, , key, text] = match;
      const expected = hebrew[key!];
      const actual = decode(text!).trim();
      if (!actual || typeof expected !== 'string' || knownDrift.includes(key!)) continue;
      if (actual !== expected.trim()) drifted.push(key!);
    }

    expect(drifted).toEqual([]);
  });

  it('keeps the household currency in ILS for every language', () => {
    const source = readFileSync(resolve(root, 'fe/src/localization.ts'), 'utf8');

    expect(source).not.toContain("'USD'");
    expect(source.match(/currency: 'ILS'/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
