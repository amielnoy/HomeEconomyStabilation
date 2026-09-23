---
name: categorise-statement
description: Fix how the Home Economy (מאזן הבית) default rules categorise transactions — find what a bank or card statement left in "other" or filed wrongly, choose safe match text, place each rule where it can answer, and pin it with tests. Use when given a statement (or merchant names) that categorises badly, when adding, moving or removing a DEFAULT_RULES entry, or when default-rules.contract.test.ts fails.
---

# Categorise a statement

The categorizer (`fe/src/categorization.ts`) gives the transaction to the **first** rule in
`DEFAULT_RULES` (`fe/src/app.ts`) whose text the description contains, case-insensitively. So
a rule's position is part of its meaning, and a rule in the wrong place compiles, reads as
intent, and decides nothing. Everything below exists to prevent that.

For a brand-new category, also follow "Adding a category" in `CLAUDE.md`.

## Privacy first

- A real statement stays **outside the repository** (`~/Downloads`, the scratchpad) and is
  never committed, copied into `tests/`, or attached anywhere. `unmatched.ts` warns if
  given a path inside the repo.
- Script output is for this session's terminal. Never paste it into source, tests,
  `TEST_PLAN.md` or a commit message.
- Only **business names** go into rules, tests and commits. A description that names a
  person — a transfer's counterparty, an account holder, a landlord — is not rule material.
  Leave it in "other"; the customer's own override covers it.
- Test rows use synthetic dates, amounts and balances, never the statement's.

## Tools

Both scripts run as plain TypeScript on Node 23.6+ (the repo uses 26). They read rules
live from `fe/src/app.ts`, so an edit counts immediately; the reader, importers and
categorizer come from `fe/dist/`. If `fe/dist/` is missing or older than `fe/src/`, run
`npx tsc -p tsconfig.app.json` first.

```bash
S=.claude/skills/categorise-statement/scripts

node $S/unmatched.ts ~/Downloads/statement.xls           # what reached no rule, biggest first
node $S/unmatched.ts --card ~/Downloads/card.xlsx        # a credit-card report
node $S/unmatched.ts --all ~/Downloads/statement.xls     # every description → category

node $S/which-rule.ts "עירית חיפה"                       # which rule wins, which it shadows
node $S/which-rule.ts --in "ביטוח לאומי קצבת ילדים"      # money arriving
node $S/which-rule.ts --rule "קיי אס פי" computing        # where a new rule may go
node $S/which-rule.ts --cats                             # the category ids
```

## Workflow

1. **Baseline.** Keep a copy of the current categorisation in the scratchpad, not the repo:
   `node $S/unmatched.ts --all <file> > "$SCRATCH/before.txt"`.
2. **Find the gaps.** `node $S/unmatched.ts <file>` lists outgoing descriptions that fell to
   "other", biggest total first, plus a summary of the share of spending affected. Scan the
   `--all` output too: a row filed **wrongly** (a charity filed as health, an allowance as
   insurance) is a defect, and usually a worse one than a gap.
3. **Decide each merchant's category** from what the household would call it, using the
   boundaries already settled (below). Skip people, anything ambiguous, and one-off
   descriptions that carry no business name.
4. **Choose the match text** (rules below), then check it:
   `node $S/which-rule.ts --rule "<match>" <category>`. It prints the rules yours must sit
   below and above, and the window of lines that satisfies both. `✗ no position` means
   change the text, not the contract.
5. **Place the rule** in its category's block within that window. If a block moves or a
   rule sits somewhere surprising, update the comment above the block to say which earlier
   blocks own the overlapping wording.
6. **Check the result.** Run `which-rule.ts` on the full original description (it should
   now name your rule and the category you meant). Then
   `node $S/unmatched.ts --all <file> > "$SCRATCH/after.txt"` and
   `diff "$SCRATCH/before.txt" "$SCRATCH/after.txt"`: every changed line must be one you
   intended. A row that moved without you meaning it is a collision — fix it now.
7. **Pin it with tests** (next section), then run them.
8. **Commit** as `feat(categories): …` or `fix(categories): …`. The body says what the
   statement exposed, which wording collided and why each block sits where it does — no
   customer details.

## Choosing match text

- **Spell names out; don't stem.** A short fragment matches inside other words:
  `'אפל'` opens אפליקציה, `'aws'` sits inside "draws", a bare `'מס'` opens מסעדה, and
  `'ביטוח'` used to file a national-insurance allowance as a health expense.
- **Skip ordinary words.** `'כולל'` is "including" (כולל מע"מ), `'קרן'` is also
  קרן השתלמות, `'לתת'` is a verb. If a word is common in Hebrew, it's not a merchant name.
- **Cover every spelling a statement uses:** עירית and עיריית, הלוואה and הלואה, Hebrew and
  Latin (`'זארה'` and `'zara'`), with and without gershayim (`'מע"מ'`, `'מע״מ'`).
- **A trailing space is a deliberate boundary.** `'פז '` and `'דלק '` match the fuel
  companies without matching פזגז or דלקת.
- Matching is **lower-cased substring**. Write Latin names in lower case; punctuation and
  spaces count.
- **Direction.** Add `'in'` when the same wording both arrives and leaves and only the
  arrival is income (`['ביטוח לאומי', 'income', 'in']`).
- Shape: `['match', 'categoryId']` or `['match', 'categoryId', 'in']`, single-quoted, in
  the literal array. The contract test parses this shape from source — keep it.

## Boundaries already settled

Keep to these unless the user decides otherwise.

- **Card settlements** (ישראכרט, כאל, מקס, ויזה…) → `credit`: the itemised card report
  carries the spending, so this line must not count it again.
- **Moving the household's own money** (העברה, הפקדה, PAYBOX, withdrawal to the account)
  → `savings`, not spending. **Maintenance** (מזונות) → `alimony`, and only on the way out:
  maintenance arriving is the receiving household's income.
- **Phone, internet and TV providers** (בזק, הוט, סלקום, פרטנר, פלאפון) → `home` — a
  household bill before it's a shop or a subscription.
- **Streaming, cinema, gyms, cafés, restaurants** → `leisure`; **software, hardware and
  cloud** → `computing`.
- **Municipality and arnona** → `home`, ahead of education and tax wording.
- **National insurance arriving** → `income`; **insurers** → `health`.
- **Tzedakah, maaser, charities** → `donations`, separate from `judaism` (synagogues,
  kashrut, religious items).
- **Loans** sit above fees and savings, because a repayment is worded as a transfer.
- **Blank or ambiguous outgoing descriptions** stay `other`. Don't guess.

## Tests

- **Real-statement fixes** → add rows to `tests/e2e/statement-categorisation.e2e.spec.ts`
  (both the CSV line and the `expected` pair), using the business name only and synthetic
  numbers. Quote a CSV field containing gershayim the way an export writes it:
  `"קיי אס פי הקריון בע""מ"`.
- **A collision you resolved** (X must not become Y) → a "separates X from what it arrives
  beside" test in `tests/e2e/credit-card-upload.e2e.spec.ts`, asserting both sides.
- **Direction behaviour** → `tests/unit/categorization.unit.test.ts`.
- **Placement invariants** (like the national-insurance ordering) →
  `tests/contract/default-rules.contract.test.ts`.
- Update the matching row's coverage text in `TEST_PLAN.md`.

Then run:

```bash
npx vitest run --environment jsdom tests/contract/default-rules.contract.test.ts tests/unit/categorization.unit.test.ts
npx tsc -p tsconfig.app.json   # browser specs load dist/
npx playwright test tests/e2e/statement-categorisation.e2e.spec.ts tests/e2e/credit-card-upload.e2e.spec.ts --project=desktop-chromium
```

## When default-rules.contract.test.ts fails

- **Unreachable rule:** an earlier rule of another category has text inside yours. Run
  `which-rule.ts --rule` for the listed rule, then move it or its rival within the printed
  window, or delete it. A rule that can decide nothing does not stay in the source.
- **Exact duplicate:** remove the second copy.
- **The national-insurance test:** `'ביטוח לאומי'` (`in`) must stay above `'ביטוח'`.
