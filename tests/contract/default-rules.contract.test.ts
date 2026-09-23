import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* The categorizer takes the first rule whose text the description contains
   (`src/categorization.ts`), so a rule's position is part of its meaning. A rule placed
   after one that already matches everything it would match is unreachable: it reads as
   intent in the source while the earlier rule decides every transaction. That is how
   'ביטוח לאומי' came to be filed as a health expense — 'ביטוח' sat above it and answered
   first — and nothing in the build or the suite noticed for as long as it was there.

   Same-category redundancy is left alone on purpose: 'העברה לחשבון' after 'העברה' is
   unreachable too, but it changes no answer and documents what the broad rule covers. */

type ParsedRule = { match: string; cat: string; when?: string; line: number };

function defaultRules(): ParsedRule[] {
  const source = readFileSync(resolve(__dirname, '../../fe/src/app.ts'), 'utf8');
  const block = source.split('const DEFAULT_RULES = [')[1]?.split('].map(')[0];
  expect(block, 'DEFAULT_RULES is no longer a literal array').toBeTruthy();

  const rules: ParsedRule[] = [];
  block!.split('\n').forEach((text, index) => {
    for (const match of text.matchAll(/\['((?:[^'\\]|\\.)*)',\s*'(\w+)'(?:,\s*'(\w+)')?\]/g)) {
      const entry: ParsedRule = { match: unescape(match[1]!), cat: match[2]!, line: index + 1 };
      if (match[3]) entry.when = match[3];
      rules.push(entry);
    }
  });
  // A sanity bound on the parsing, not on the list: rules are added and removed freely.
  expect(rules.length).toBeGreaterThan(50);
  return rules;
}

const unescape = (value: string) =>
  value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\\'/g, "'");

/* Two rules can both answer a description only when their directions overlap. */
const sameDirection = (a: ParsedRule, b: ParsedRule) => !a.when || !b.when || a.when === b.when;

describe('default categorization rules', () => {
  it('leaves no rule unreachable behind an earlier rule of a different category', () => {
    const rules = defaultRules();
    const unreachable = rules.filter((rule, index) => rules.some((earlier, before) =>
      before < index && earlier.cat !== rule.cat && sameDirection(earlier, rule)
      && rule.match.toLocaleLowerCase().includes(earlier.match.toLocaleLowerCase())));

    expect(unreachable.map((rule) => `'${rule.match}' -> ${rule.cat}`)).toEqual([]);
  });

  it('files an arriving national insurance allowance as income, not as an insurance expense', () => {
    const rules = defaultRules();
    const allowance = rules.findIndex((rule) => rule.match === 'ביטוח לאומי');
    const insurance = rules.findIndex((rule) => rule.match === 'ביטוח');

    expect(allowance, 'the national insurance rule is gone').toBeGreaterThanOrEqual(0);
    expect(rules[allowance]).toMatchObject({ cat: 'income', when: 'in' });
    expect(allowance, 'ביטוח would answer first and file the allowance as health').toBeLessThan(insurance);
  });

  it('carries no rule that repeats an earlier rule exactly', () => {
    const seen = new Map<string, ParsedRule>();
    const duplicates: string[] = [];
    for (const rule of defaultRules()) {
      const key = `${rule.match}|${rule.cat}|${rule.when ?? ''}`;
      if (seen.has(key)) duplicates.push(`'${rule.match}' -> ${rule.cat}`);
      else seen.set(key, rule);
    }
    expect(duplicates).toEqual([]);
  });
});
