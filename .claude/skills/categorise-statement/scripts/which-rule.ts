/* Which default rule answers a description — and where a proposed rule may go.

   node .claude/skills/categorise-statement/scripts/which-rule.ts [--in] "<description>" [...]
       The rule that wins, every rule it shadows, and the app categorizer's own answer.
   node .claude/skills/categorise-statement/scripts/which-rule.ts --rule "<match>" <category> [--in]
       The placement window for a new rule: which rules it must sit below (or it can never
       answer) and above (or they can never answer). Mirrors default-rules.contract.test.ts.
   node .claude/skills/categorise-statement/scripts/which-rule.ts --cats
       The category ids a rule may name. */

import {
  defaultCategories, defaultRules, matchingRules, realCategorizer, sameDirection,
  type Direction, type SourceRule,
} from './rules.ts';

const args = process.argv.slice(2);
const direction: Direction = args.includes('--in') ? 'in' : 'out';
const positional = args.filter((arg) => !arg.startsWith('--'));
const describe = (rule: SourceRule): string =>
  `src/app.ts:${rule.line}  '${rule.match}' → ${rule.cat}${rule.when ? ` (${rule.when} only)` : ''}`;

if (args.includes('--cats')) {
  for (const category of defaultCategories()) {
    console.log(`${category.id.padEnd(10)} ${category.kind.padEnd(8)} ${category.name}`);
  }
} else if (args.includes('--rule')) {
  const [match, category] = positional;
  if (!match || !category) {
    console.error('usage: which-rule.ts --rule "<match>" <category> [--in]');
    process.exit(2);
  }
  if (!defaultCategories().some((known) => known.id === category)) {
    console.error(`unknown category '${category}' — see --cats`);
    process.exit(2);
  }
  const when: Direction | undefined = args.includes('--in') ? 'in' : undefined;
  const proposed = match.toLocaleLowerCase();
  const rules = defaultRules();
  const rivals = rules.filter((rule) => rule.cat !== category && sameDirection(rule.when, when));
  // A rival whose text is inside yours answers everything yours would, so yours must come first.
  const precede = rivals.filter((rule) => proposed.includes(rule.match.toLocaleLowerCase()));
  // A rival whose text contains yours could never answer behind yours, so yours must come after.
  const follow = rivals.filter((rule) => rule.match.toLocaleLowerCase().includes(proposed));
  const own = rules.filter((rule) => rule.cat === category);

  console.log(`proposed '${match}' → ${category}${when ? ' (in only)' : ''}`);
  for (const rule of precede) console.log(`  must sit ABOVE  ${describe(rule)}   (its text is inside yours)`);
  for (const rule of follow) console.log(`  must sit BELOW  ${describe(rule)}   (yours is inside its text)`);
  const lowest = follow.at(-1);
  const highest = precede[0];
  if (lowest && highest && lowest.index >= highest.index) {
    console.log('  ✗ no position satisfies both — choose a longer or different match text, or leave the rule out');
    process.exitCode = 1;
  } else {
    const after = lowest ? `after '${lowest.match}' (src/app.ts:${lowest.line})` : 'anywhere from the top';
    const before = highest ? ` and before '${highest.match}' (src/app.ts:${highest.line})` : '';
    console.log(`  ✓ ${after}${before}`);
  }
  if (own.length) console.log(`  the ${category} rules sit at src/app.ts:${own[0]!.line}–${own.at(-1)!.line}`);
} else if (positional.length) {
  const rules = defaultRules();
  const categorizer = await realCategorizer();
  for (const description of positional) {
    const hits = matchingRules(description, direction, rules);
    const row = { id: '', desc: description, in: direction === 'in' ? 1 : 0, out: direction === 'out' ? 1 : 0 };
    const answer = categorizer.categorize(row, {}, rules);
    console.log(`"${description}" (${direction}) → ${answer}${hits.length ? '' : '  — no rule matches'}`);
    hits.forEach((rule, index) => console.log(`  ${index === 0 ? 'wins    ' : 'shadowed'}  ${describe(rule)}`));
    if (hits[0] && hits[0].cat !== answer) {
      console.warn(`  ! the app answered ${answer}, not ${hits[0].cat}: this script has drifted from src/categorization.ts`);
      process.exitCode = 1;
    }
  }
} else {
  console.error('usage: which-rule.ts [--in] "<description>" [...] | --rule "<match>" <category> [--in] | --cats');
  process.exit(2);
}
