import type { BankTransaction } from './domain-model.js';

/* The household's month written the way a financial plan is written: what came in, what
   leaves whether or not anyone decided it this month, what was decided this month, and
   what was set aside. The four sections are the ones a מיפוי worksheet asks a household to
   fill in by hand — filled here from the statements already imported, so nothing on the
   screen is a number anybody typed or guessed. */
export type PlanSectionKind = 'income' | 'fixed' | 'variable' | 'savings';

export interface PlanLine {
  /** A category id in the three expense sections; the payee on the income side, because
      "income" is one category and a household reads its income by where it comes from. */
  readonly key: string;
  /** Net, signed the way the section reads it: money in for income, money out for the
      rest. A line can come out negative — a refund larger than the month's charges — and
      it stays on the screen, because a section whose lines do not add up to its total is
      worse than one with an awkward line in it. */
  readonly amount: number;
  readonly count: number;
}

export interface PlanSection {
  readonly kind: PlanSectionKind;
  readonly total: number;
  readonly lines: readonly PlanLine[];
}

export interface FinancialPlan {
  readonly income: PlanSection;
  readonly fixed: PlanSection;
  readonly variable: PlanSection;
  readonly savings: PlanSection;
  /** Everything that left, set-aside money included: a shekel moved to savings is not
      spent, but it is not available either, and a plan that left it out would report a
      surplus the household cannot touch. */
  readonly outgoing: number;
  readonly surplus: number;
}

const sectionOf = (
  kind: PlanSectionKind,
  totals: ReadonlyMap<string, { amount: number; count: number }>,
): PlanSection => {
  const lines = [...totals.entries()]
    .map(([key, value]) => ({ key, amount: value.amount, count: value.count }))
    .sort((a, b) => b.amount - a.amount);
  return { kind, total: lines.reduce((sum, line) => sum + line.amount, 0), lines };
};

const add = (
  totals: Map<string, { amount: number; count: number }>,
  key: string,
  amount: number,
) => {
  const current = totals.get(key) ?? { amount: 0, count: 0 };
  totals.set(key, { amount: current.amount + amount, count: current.count + 1 });
};

/**
 * `isFixed` decides which side of the expense a charge falls on. It is asked rather than
 * worked out here because what makes a charge fixed is that it came before — the same
 * payee in an earlier month — and that is the recurring-charge agent's answer, not a
 * property of the row. `incomeLabel` names an income line: salary and an allowance are
 * both `income`, and a household that cannot tell them apart cannot read its own month.
 */
export function buildFinancialPlan(
  transactions: readonly BankTransaction[],
  isFixed: (transaction: BankTransaction) => boolean,
  incomeLabel: (transaction: BankTransaction) => string,
): FinancialPlan {
  const income = new Map<string, { amount: number; count: number }>();
  const fixed = new Map<string, { amount: number; count: number }>();
  const variable = new Map<string, { amount: number; count: number }>();
  const savings = new Map<string, { amount: number; count: number }>();

  for (const transaction of transactions) {
    const category = transaction.cat ?? 'other';
    if (transaction.kind === 'income') {
      add(income, incomeLabel(transaction), transaction.in - transaction.out);
      continue;
    }
    if (transaction.kind === 'neutral') {
      add(savings, category, transaction.out - transaction.in);
      continue;
    }
    add(isFixed(transaction) ? fixed : variable, category, transaction.out - transaction.in);
  }

  const sections = {
    income: sectionOf('income', income),
    fixed: sectionOf('fixed', fixed),
    variable: sectionOf('variable', variable),
    savings: sectionOf('savings', savings),
  };
  const outgoing = sections.fixed.total + sections.variable.total + sections.savings.total;
  return { ...sections, outgoing, surplus: sections.income.total - outgoing };
}
