/* Shared by which-rule.ts and unmatched.ts. Runs on Node 23.6+ as plain TypeScript
   (type stripping), so keep to erasable syntax: no enums, no parameter properties. */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');

export type Direction = 'in' | 'out';
/** `index` is the position the categorizer tries it at; `line` is for people (a line holds several rules). */
export interface SourceRule { id: string; index: number; match: string; cat: string; when?: Direction; line: number }
export interface SourceCategory { id: string; name: string; kind: string }
export interface Categorizer {
  categorize(transaction: object, overrides: Record<string, string>, rules: readonly SourceRule[]): string;
}

const unquote = (value: string): string => value
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
  .replace(/\\'/g, "'");

function block(marker: string, terminator: string): { body: string; firstLine: number } {
  const text = readFileSync(resolve(repoRoot, 'src/app.ts'), 'utf8');
  const start = text.indexOf(marker);
  const end = text.indexOf(terminator, start);
  if (start < 0 || end < 0) throw new Error(`${marker.trim()} is no longer a literal array in src/app.ts`);
  return { body: text.slice(start + marker.length, end), firstLine: text.slice(0, start).split('\n').length };
}

/* Parsed from src/app.ts with the same pattern tests/contract/default-rules.contract.test.ts
   uses, so this script and the contract agree on the list. Read from source rather than
   dist/ so an edit counts without a rebuild. */
export function defaultRules(): SourceRule[] {
  const { body, firstLine } = block('const DEFAULT_RULES = [', '].map(');
  const rules: SourceRule[] = [];
  body.split('\n').forEach((row, offset) => {
    for (const m of row.matchAll(/\['((?:[^'\\]|\\.)*)',\s*'(\w+)'(?:,\s*'(\w+)')?\]/g)) {
      const rule: SourceRule = {
        id: `r${rules.length}`, index: rules.length, match: unquote(m[1]!), cat: m[2]!, line: firstLine + offset,
      };
      if (m[3]) rule.when = m[3] as Direction;
      rules.push(rule);
    }
  });
  if (rules.length < 50) throw new Error(`parsed only ${rules.length} rules from DEFAULT_RULES — the literal changed shape`);
  return rules;
}

export function defaultCategories(): SourceCategory[] {
  const { body } = block('const DEFAULT_CATS: Category[] = [', '];');
  return [...body.matchAll(/\{\s*id:\s*'(\w+)',\s*name:\s*'([^']*)',\s*kind:\s*'(\w+)'\s*\}/g)]
    .map((m) => ({ id: m[1]!, name: m[2]!, kind: m[3]! }));
}

export const directionOf = (row: { in: number }): Direction => (row.in > 0 ? 'in' : 'out');

/** Two rules can both answer a description only when their directions overlap. */
export const sameDirection = (a?: Direction, b?: Direction): boolean => !a || !b || a === b;

/** Every rule that would answer, in the order the categorizer tries them. */
export function matchingRules(description: string, direction: Direction, rules: readonly SourceRule[]): SourceRule[] {
  const text = description.toLocaleLowerCase();
  return rules.filter((rule) => rule.match && sameDirection(rule.when, direction)
    && text.includes(rule.match.toLocaleLowerCase()));
}

export async function fromDist<T>(module: string): Promise<T> {
  const file = resolve(repoRoot, 'dist', `${module}.js`);
  if (!existsSync(file)) throw new Error(`dist/${module}.js is missing — run: npx tsc -p tsconfig.app.json`);
  return import(pathToFileURL(file).href) as Promise<T>;
}

/** The app's own categorizer, so the answer here is the answer on screen. */
export async function realCategorizer(): Promise<Categorizer> {
  const { RuleBasedTransactionCategorizer } =
    await fromDist<{ RuleBasedTransactionCategorizer: new () => Categorizer }>('categorization');
  return new RuleBasedTransactionCategorizer();
}
