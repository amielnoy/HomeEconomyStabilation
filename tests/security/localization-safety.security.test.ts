import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatMessage, SUPPORTED_LOCALES } from '../../src/localization';

/* Resource files are the one place where text authored outside the application is written
   straight into the page, and a translation arrives through a pull request like any other
   change. The strings are applied with textContent today; these tests hold that boundary
   so a future innerHTML, or a translation carrying markup, is a failure and not an
   incident. */

const root = resolve(__dirname, '../..');
const entries = SUPPORTED_LOCALES.flatMap((locale) => {
  const raw = readFileSync(resolve(root, `resources/${locale}.json`), 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const flatten = (value: unknown, path: string): Array<[string, string]> => {
    if (typeof value === 'string') return [[`${locale}.${path}`, value]];
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>)
        .flatMap(([key, nested]) => flatten(nested, `${path}.${key}`));
    }
    return [];
  };
  return Object.entries(parsed).flatMap(([key, value]) => flatten(value, key));
});

describe('localization safety', () => {
  it('ships translations that carry no markup to become nodes', () => {
    const withMarkup = entries
      .filter(([, value]) => /<\s*\/?\s*[a-z][^>]*>/i.test(value))
      .map(([path]) => path);

    expect(withMarkup).toEqual([]);
  });

  it('ships translations that carry no executable or data URLs', () => {
    const withUrls = entries
      .filter(([, value]) => /javascript:|data:text\/html|vbscript:/i.test(value))
      .map(([path]) => path);

    expect(withUrls).toEqual([]);
  });

  /* A resource file is parsed JSON, and a key named __proto__ in parsed JSON is the
     shortest path there is from a translation to changed behaviour everywhere. */
  it('declares no prototype-polluting keys in any resource file', () => {
    const dangerous = ['__proto__', 'constructor', 'prototype'];
    for (const locale of SUPPORTED_LOCALES) {
      const raw = readFileSync(resolve(root, `resources/${locale}.json`), 'utf8');

      for (const key of dangerous) {
        expect(raw, `${locale} declares ${key}`).not.toContain(`"${key}"`);
      }
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  });

  /* Substitution must not let a parameter smuggle a second placeholder into the sentence
     and have it expanded in a later pass. */
  it('does not re-expand a placeholder that arrived inside a parameter', () => {
    const rendered = formatMessage('{file} נטען', { file: '{columns}' });

    expect(rendered).toBe('{columns} נטען');
  });
});
