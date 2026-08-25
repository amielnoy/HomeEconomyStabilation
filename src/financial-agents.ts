export interface AgentTransaction {
  id?: string;
  date: string;
  desc: string;
  out: number;
  in: number;
  bal: number | null;
  cat?: string;
}

export interface AgentCategory { id: string; kind: 'expense' | 'income' | 'neutral' }
export interface AgentRule { match: string; cat: string }

export interface LearningProposal { match: string; categoryId: string; examples: string[] }
export interface AmountAnomaly { merchant: string; latest: number; baseline: number; percent: number }
export interface MissingCharge { merchant: string; amount: number; direction: 'in' | 'out'; expectedDay: number }
export interface DuplicateCharge { merchant: string; amount: number; firstDate: string; secondDate: string }
export interface SubscriptionFinding { merchant: string; monthly: number; annual: number; increasePercent: number }
export interface BudgetSuggestion { categoryId: string; suggested: number; months: number }
/** Which constraint produced `freeToSpend`, so the interface can explain the number. */
export type SpendingLimitBasis = 'balance' | 'spending-rate';
export type SavingsOpportunityType = 'subscription-review' | 'price-increase' | 'fee-review' | 'duplicate-review';
export interface SavingsOpportunity {
  id: string;
  type: SavingsOpportunityType;
  merchant: string;
  estimatedSaving: number;
  cadence: 'annual' | 'one-time';
  confidence: number;
  evidenceTransactionIds: string[];
  increasePercent?: number;
}
export interface PaydayRunway {
  /** The newest balance found in the data — not necessarily today's balance. */
  balance: number;
  /** The date `balance` was observed. Every figure below is anchored to it. */
  asOf: string;
  nextIncomeDate: string | null;
  committed: number;
  /** balance − committed: what is left once known recurring charges clear. */
  available: number;
  /** One median month of outflow — reported as context, never silently subtracted. */
  retained: number;
  /** What the household normally spends outside recurring charges over the remaining days. */
  typicalSpend: number;
  /** min(available, typicalSpend), floored at 0. Never the whole balance. */
  freeToSpend: number;
  limitedBy: SpendingLimitBasis;
  daysRemaining: number | null;
  dailyAllowance: number | null;
  weeklyAllowance: number | null;
}

export interface FinancialAgentResults {
  learning: LearningProposal | null;
  anomalies: AmountAnomaly[];
  missing: MissingCharge[];
  duplicates: DuplicateCharge[];
  subscriptions: SubscriptionFinding[];
  budgetSuggestions: BudgetSuggestion[];
  savingsOpportunities: SavingsOpportunity[];
  payday: PaydayRunway | null;
}

export interface FinancialAgentContext {
  transactions: AgentTransaction[];
  overrides: Record<string, string>;
  rules: AgentRule[];
  categories: AgentCategory[];
}

export interface FinancialAgentStrategy<Result> {
  analyze(context: Readonly<FinancialAgentContext>): Result;
}

const DAY = 86_400_000;
const dateValue = (date: string) => new Date(`${date}T00:00:00Z`).getTime();
const monthKey = (date: string) => date.slice(0, 7);
const dayOfMonth = (date: string) => Number(date.slice(8, 10));
const dateAtMonthDay = (year: number, month: number, day: number) => {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
};
const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const percentile75 = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * .75) - 1)]!;
};

export function merchantKey(description: string): string {
  return description
    .toLocaleLowerCase()
    .replace(/[0-9#*._/\\-]+/g, ' ')
    .replace(/[^\p{L}\p{M}\s]/gu, ' ')
    .replace(/\b(?:visa|mastercard|ישראכרט|כאל|max|בעמ|בע״מ|תשלום|העברה)\b/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 4)
    .join(' ');
}

function groups(transactions: AgentTransaction[]) {
  const map = new Map<string, AgentTransaction[]>();
  for (const transaction of transactions) {
    const key = merchantKey(transaction.desc);
    if (!key) continue;
    // Append in place; rebuilding the bucket on every insert made grouping quadratic.
    const bucket = map.get(key);
    if (bucket) bucket.push(transaction);
    else map.set(key, [transaction]);
  }
  return map;
}

export function learningAgent(
  transactions: AgentTransaction[],
  overrides: Record<string, string>,
  rules: AgentRule[],
): LearningProposal | null {
  const manuallyClassified = transactions.filter((transaction) => transaction.id && overrides[transaction.id]);
  for (const [match, items] of groups(manuallyClassified)) {
    const categories = new Set(items.flatMap((item) => {
      const assigned = item.id ? overrides[item.id] : undefined;
      return assigned ? [assigned] : [];
    }));
    if (items.length < 2 || categories.size !== 1 || match.length < 3) continue;
    const categoryId = [...categories][0];
    if (!categoryId) continue;
    if (rules.some((rule) => rule.cat === categoryId && merchantKey(rule.match) === match)) continue;
    return { match, categoryId, examples: items.slice(0, 3).map((item) => item.desc) };
  }
  return null;
}

export function anomalyAgent(transactions: AgentTransaction[]): AmountAnomaly[] {
  const findings: AmountAnomaly[] = [];
  for (const [merchant, items] of groups(transactions.filter((item) => item.out > 0))) {
    const sorted = [...items].sort((a, b) => dateValue(a.date) - dateValue(b.date));
    if (new Set(sorted.map((item) => monthKey(item.date))).size < 3) continue;
    const latest = sorted.at(-1)!;
    const history = sorted.slice(0, -1).map((item) => item.out).filter((amount) => amount > 0);
    if (history.length < 2) continue;
    const baseline = median(history);
    const percent = baseline ? Math.round(((latest.out - baseline) / baseline) * 100) : 0;
    if (percent >= 30 && latest.out > Math.max(...history) * 1.15) {
      findings.push({ merchant, latest: latest.out, baseline, percent });
    }
  }
  return findings.sort((a, b) => b.percent - a.percent);
}

export function missingChargeAgent(transactions: AgentTransaction[]): MissingCharge[] {
  const newest = [...transactions].sort((a, b) => dateValue(b.date) - dateValue(a.date))[0];
  if (!newest) return [];
  const asOf = newest.date;
  const currentMonth = monthKey(asOf);
  const currentDay = dayOfMonth(asOf);
  const findings: MissingCharge[] = [];
  for (const [merchant, items] of groups(transactions.filter((item) => item.out > 0 || item.in > 0))) {
    const byMonth = new Set(items.map((item) => monthKey(item.date)));
    if (byMonth.size < 2 || byMonth.has(currentMonth)) continue;
    const expectedDay = Math.round(median(items.map((item) => dayOfMonth(item.date))));
    if (currentDay < expectedDay + 4) continue;
    const incoming = items.filter((item) => item.in > 0).length > items.length / 2;
    const amounts = items.map((item) => incoming ? item.in : item.out).filter(Boolean);
    findings.push({ merchant, amount: median(amounts), direction: incoming ? 'in' : 'out', expectedDay });
  }
  return findings;
}

export function duplicateAgent(transactions: AgentTransaction[]): DuplicateCharge[] {
  const findings: DuplicateCharge[] = [];
  for (const [merchant, items] of groups(transactions.filter((item) => item.out > 0))) {
    const sorted = [...items].sort((a, b) => dateValue(a.date) - dateValue(b.date));
    for (let index = 1; index < sorted.length; index += 1) {
      const first = sorted[index - 1], second = sorted[index];
      if (!first || !second) continue;
      const days = Math.round((dateValue(second.date) - dateValue(first.date)) / DAY);
      const tolerance = Math.max(1, first.out * .005);
      if (days >= 1 && days <= 5 && Math.abs(first.out - second.out) <= tolerance) {
        findings.push({ merchant, amount: second.out, firstDate: first.date, secondDate: second.date });
      }
    }
  }
  return findings;
}

/* A recurring charge is only a *subscription* if cancelling it is actually an option.
   Utilities, municipal rates, rent, mortgage, card settlements and the household's own
   cash withdrawals are recurring and stable, but they are obligations or transfers —
   presenting their annual value as a saving is not advice, it is a fiction. */
const NON_SUBSCRIPTION_CATEGORIES = new Set(['home', 'cash', 'fees', 'credit', 'savings', 'income']);
const OBLIGATION_OR_CASH = new RegExp([
  'חשמל', 'מים', 'מקורות', 'תאגיד', 'ארנונה', 'עיריי', 'גז', 'משכנתא', 'שכירות', 'ועד בית',
  'בנקט', 'כספומט', 'משיכת מזומן', 'מזונות', 'ביטוח לאומי',
  'electric', 'water', 'municipal', 'mortgage', 'rent', 'atm', 'cash withdrawal', 'utilit',
].join('|'), 'iu');

/** Fixed-price recurring charges only: an unchanging amount is what separates a
    subscription from a bill that merely repeats. Measured across the *prior* charges
    rather than the whole series, so a genuine price rise reads as a rise and not as
    the noise of a metered bill. */
const SUBSCRIPTION_MAX_SPREAD = .12;

function isCancellable(item: AgentTransaction): boolean {
  if (item.cat && NON_SUBSCRIPTION_CATEGORIES.has(item.cat)) return false;
  return !OBLIGATION_OR_CASH.test(item.desc);
}

export function subscriptionAgent(transactions: AgentTransaction[]): SubscriptionFinding[] {
  const findings: SubscriptionFinding[] = [];
  const candidates = transactions.filter((item) => item.out > 0 && item.out <= 600 && isCancellable(item));
  for (const [merchant, items] of groups(candidates)) {
    const sorted = [...items].sort((a, b) => dateValue(a.date) - dateValue(b.date));
    if (new Set(sorted.map((item) => monthKey(item.date))).size < 3) continue;
    const previous = sorted.slice(0, -1).map((item) => item.out);
    const monthly = median(sorted.map((item) => item.out));
    if (!monthly || !previous.length) continue;
    const baseline = median(previous);
    const baselineSpread = Math.max(...previous) - Math.min(...previous);
    if (!baseline || baselineSpread / baseline > SUBSCRIPTION_MAX_SPREAD) continue;
    const latest = sorted.at(-1);
    if (!latest) continue;
    const oldBaseline = baseline;
    const increasePercent = oldBaseline ? Math.max(0, Math.round(((latest.out - oldBaseline) / oldBaseline) * 100)) : 0;
    findings.push({ merchant, monthly, annual: monthly * 12, increasePercent });
  }
  return findings.sort((a, b) => b.annual - a.annual);
}

export function budgetAgent(
  transactions: AgentTransaction[],
  categories: AgentCategory[],
): BudgetSuggestion[] {
  const recentMonths = [...new Set(transactions.map((item) => monthKey(item.date)))].sort().reverse().slice(0, 3);
  return categories.filter((category) => category.kind === 'expense').flatMap((category) => {
    const totals = recentMonths.map((month) => transactions
      .filter((item) => monthKey(item.date) === month && item.cat === category.id)
      .reduce((sum, item) => sum + item.out, 0));
    if (!totals.some((total) => total > 0)) return [];
    const suggested = Math.max(50, Math.ceil(percentile75(totals) / 50) * 50);
    return [{ categoryId: category.id, suggested, months: recentMonths.length }];
  });
}

const feeDescription = (description: string) => /(?:עמל|דמי כרטיס|bank fee|account fee|commission|frais|ኮሚሽን)/iu.test(description);
const confidenceForMonths = (months: number, base = .55) => Math.min(.95, base + months * .1);

export function savingsOpportunityAgent(transactions: AgentTransaction[]): SavingsOpportunity[] {
  const opportunities: SavingsOpportunity[] = [];
  const outgoing = transactions.filter((item) => item.out > 0);
  const outgoingGroups = groups(outgoing);

  for (const [merchant, items] of groups(outgoing.filter((item) => feeDescription(item.desc)))) {
    const months = new Set(items.map((item) => monthKey(item.date))).size;
    if (months < 2) continue;
    const monthly = median(items.map((item) => item.out));
    opportunities.push({
      id: `fee:${merchant}`,
      type: 'fee-review',
      merchant,
      estimatedSaving: monthly * 12,
      cadence: 'annual',
      confidence: confidenceForMonths(months, .5),
      evidenceTransactionIds: items.flatMap((item) => item.id ? [item.id] : []),
    });
  }

  for (const subscription of subscriptionAgent(outgoing)) {
    const items = [...(outgoingGroups.get(subscription.merchant) || [])]
      .sort((a, b) => dateValue(a.date) - dateValue(b.date));
    if (items.some((item) => feeDescription(item.desc))) continue;
    const months = new Set(items.map((item) => monthKey(item.date))).size;
    const previous = items.slice(0, -1).map((item) => item.out);
    const previousMonthly = previous.length ? median(previous) : subscription.monthly;
    const latest = items.at(-1)?.out || subscription.monthly;
    const priceIncreaseSaving = Math.max(0, (latest - previousMonthly) * 12);
    opportunities.push({
      id: `${subscription.increasePercent >= 5 ? 'price' : 'subscription'}:${subscription.merchant}`,
      type: subscription.increasePercent >= 5 ? 'price-increase' : 'subscription-review',
      merchant: subscription.merchant,
      estimatedSaving: subscription.increasePercent >= 5 ? priceIncreaseSaving : subscription.annual,
      cadence: 'annual',
      confidence: confidenceForMonths(months),
      evidenceTransactionIds: items.flatMap((item) => item.id ? [item.id] : []),
      ...(subscription.increasePercent >= 5 ? { increasePercent: subscription.increasePercent } : {}),
    });
  }

  for (const duplicate of duplicateAgent(outgoing)) {
    const evidence = outgoing.filter((item) => merchantKey(item.desc) === duplicate.merchant
      && [duplicate.firstDate, duplicate.secondDate].includes(item.date)
      && Math.abs(item.out - duplicate.amount) <= Math.max(1, duplicate.amount * .005));
    opportunities.push({
      id: `duplicate:${duplicate.merchant}:${duplicate.firstDate}:${duplicate.secondDate}`,
      type: 'duplicate-review',
      merchant: duplicate.merchant,
      estimatedSaving: duplicate.amount,
      cadence: 'one-time',
      confidence: .9,
      evidenceTransactionIds: evidence.flatMap((item) => item.id ? [item.id] : []),
    });
  }

  return opportunities
    .filter((item) => item.estimatedSaving > 0)
    .sort((a, b) => b.estimatedSaving - a.estimatedSaving || b.confidence - a.confidence);
}

/** One median month of outflow, held back as a cushion rather than offered as spendable. */
function monthlyOutflowCushion(transactions: AgentTransaction[]): number {
  const perMonth = new Map<string, number>();
  for (const item of transactions) {
    if (item.out <= 0) continue;
    const key = monthKey(item.date);
    perMonth.set(key, (perMonth.get(key) || 0) + item.out);
  }
  return median([...perMonth.values()]);
}

/** Typical daily outflow that is *not* part of a recurring group — the household's
    ordinary discretionary rate, measured over the 90 days before `asOfTime`. */
function discretionaryDailyRate(transactions: AgentTransaction[], asOfTime: number, recurringKeys: ReadonlySet<string>): number {
  const windowStart = asOfTime - 89 * DAY;
  const perDay = new Map<string, number>();
  for (const item of transactions) {
    if (item.out <= 0) continue;
    const time = dateValue(item.date);
    if (time < windowStart || time > asOfTime) continue;
    if (recurringKeys.has(merchantKey(item.desc))) continue;
    perDay.set(item.date, (perDay.get(item.date) || 0) + item.out);
  }
  if (!perDay.size) return 0;
  const days: number[] = [];
  for (let time = windowStart; time <= asOfTime; time += DAY) {
    days.push(perDay.get(new Date(time).toISOString().slice(0, 10)) || 0);
  }
  // Mean, not median: most days are zero, and the cadence of spending is what matters.
  return days.reduce((sum, value) => sum + value, 0) / days.length;
}

export function paydayAgent(transactions: AgentTransaction[]): PaydayRunway | null {
  const withBalance = transactions.filter((item) => item.bal != null).sort((a, b) => dateValue(b.date) - dateValue(a.date));
  const latest = withBalance[0];
  if (!latest || latest.bal == null) return null;
  const balance = latest.bal;
  const asOf = latest.date;
  const latestTime = dateValue(asOf);
  const retained = monthlyOutflowCushion(transactions);

  const recurringIncome = [...groups(transactions.filter((item) => item.in > 0)).entries()]
    .filter(([, items]) => new Set(items.map((item) => monthKey(item.date))).size >= 2)
    .sort((a, b) => median(b[1].map((item) => item.in)) - median(a[1].map((item) => item.in)))[0];
  if (!recurringIncome) {
    // No payday means no period to spread across, so there is nothing to cap against.
    return {
      balance, asOf, nextIncomeDate: null, committed: 0, available: balance, retained,
      typicalSpend: 0, freeToSpend: balance, limitedBy: 'balance',
      daysRemaining: null, dailyAllowance: null, weeklyAllowance: null,
    };
  }

  const expectedDay = Math.round(median(recurringIncome[1].map((item) => dayOfMonth(item.date))));
  const cursor = new Date(`${asOf}T00:00:00Z`);
  let nextIncome = dateAtMonthDay(cursor.getUTCFullYear(), cursor.getUTCMonth(), expectedDay);
  if (nextIncome.getTime() <= latestTime) nextIncome = dateAtMonthDay(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, expectedDay);

  const outgoingGroups = groups(transactions.filter((item) => item.out > 0));
  const recurringKeys = new Set<string>();
  let committed = 0;
  for (const [merchant, items] of outgoingGroups) {
    if (new Set(items.map((item) => monthKey(item.date))).size < 2) continue;
    recurringKeys.add(merchant);
    const dueDay = Math.round(median(items.map((item) => dayOfMonth(item.date))));
    let due = dateAtMonthDay(cursor.getUTCFullYear(), cursor.getUTCMonth(), dueDay);
    if (due.getTime() <= latestTime) due = dateAtMonthDay(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, dueDay);
    if (due < nextIncome) committed += median(items.map((item) => item.out));
  }

  const daysRemaining = Math.max(1, Math.ceil((nextIncome.getTime() - latestTime) / DAY));
  const available = balance - committed;
  const typicalSpend = discretionaryDailyRate(transactions, latestTime, recurringKeys) * daysRemaining;
  /* The balance is a ceiling, never the answer: an account holding months of savings
     does not make those savings this fortnight's spending money. The guidance is the
     lower of "what the balance can bear" and "what this household normally spends in
     the remaining days" — so a large balance stops being an invitation to spend it.
     With too little history to estimate a rate, the balance stands alone rather than
     collapsing the guidance to zero. */
  const hasSpendingHistory = typicalSpend > 0;
  const limitedBy: SpendingLimitBasis = !hasSpendingHistory || available <= typicalSpend
    ? 'balance' : 'spending-rate';
  const freeToSpend = Math.max(0, hasSpendingHistory ? Math.min(available, typicalSpend) : available);
  const dailyAllowance = freeToSpend / daysRemaining;
  return {
    balance, asOf, nextIncomeDate: nextIncome.toISOString().slice(0, 10), committed, available,
    retained, typicalSpend, freeToSpend, limitedBy,
    daysRemaining, dailyAllowance, weeklyAllowance: dailyAllowance * 7,
  };
}

export class LearningAgentStrategy implements FinancialAgentStrategy<LearningProposal | null> {
  analyze(context: Readonly<FinancialAgentContext>) {
    return learningAgent(context.transactions, context.overrides, context.rules);
  }
}

export class AnomalyAgentStrategy implements FinancialAgentStrategy<AmountAnomaly[]> {
  analyze(context: Readonly<FinancialAgentContext>) { return anomalyAgent(context.transactions); }
}

export class MissingChargeAgentStrategy implements FinancialAgentStrategy<MissingCharge[]> {
  analyze(context: Readonly<FinancialAgentContext>) { return missingChargeAgent(context.transactions); }
}

export class DuplicateAgentStrategy implements FinancialAgentStrategy<DuplicateCharge[]> {
  analyze(context: Readonly<FinancialAgentContext>) { return duplicateAgent(context.transactions); }
}

export class SubscriptionAgentStrategy implements FinancialAgentStrategy<SubscriptionFinding[]> {
  analyze(context: Readonly<FinancialAgentContext>) { return subscriptionAgent(context.transactions); }
}

export class BudgetAgentStrategy implements FinancialAgentStrategy<BudgetSuggestion[]> {
  analyze(context: Readonly<FinancialAgentContext>) { return budgetAgent(context.transactions, context.categories); }
}

export class SavingsOpportunityAgentStrategy implements FinancialAgentStrategy<SavingsOpportunity[]> {
  analyze(context: Readonly<FinancialAgentContext>) { return savingsOpportunityAgent(context.transactions); }
}

export class PaydayAgentStrategy implements FinancialAgentStrategy<PaydayRunway | null> {
  analyze(context: Readonly<FinancialAgentContext>) { return paydayAgent(context.transactions); }
}

export interface FinancialAgentStrategies {
  learning: FinancialAgentStrategy<LearningProposal | null>;
  anomalies: FinancialAgentStrategy<AmountAnomaly[]>;
  missing: FinancialAgentStrategy<MissingCharge[]>;
  duplicates: FinancialAgentStrategy<DuplicateCharge[]>;
  subscriptions: FinancialAgentStrategy<SubscriptionFinding[]>;
  budgetSuggestions: FinancialAgentStrategy<BudgetSuggestion[]>;
  savingsOpportunities: FinancialAgentStrategy<SavingsOpportunity[]>;
  payday: FinancialAgentStrategy<PaydayRunway | null>;
}

export class FinancialAgentsOrchestrator {
  constructor(private readonly strategies: Readonly<FinancialAgentStrategies>) {}

  run(context: Readonly<FinancialAgentContext>): FinancialAgentResults {
    return {
      learning: this.strategies.learning.analyze(context),
      anomalies: this.strategies.anomalies.analyze(context),
      missing: this.strategies.missing.analyze(context),
      duplicates: this.strategies.duplicates.analyze(context),
      subscriptions: this.strategies.subscriptions.analyze(context),
      budgetSuggestions: this.strategies.budgetSuggestions.analyze(context),
      savingsOpportunities: this.strategies.savingsOpportunities.analyze(context),
      payday: this.strategies.payday.analyze(context),
    };
  }
}

const defaultFinancialAgents = new FinancialAgentsOrchestrator({
  learning: new LearningAgentStrategy(),
  anomalies: new AnomalyAgentStrategy(),
  missing: new MissingChargeAgentStrategy(),
  duplicates: new DuplicateAgentStrategy(),
  subscriptions: new SubscriptionAgentStrategy(),
  budgetSuggestions: new BudgetAgentStrategy(),
  savingsOpportunities: new SavingsOpportunityAgentStrategy(),
  payday: new PaydayAgentStrategy(),
});

export function runFinancialAgents(input: FinancialAgentContext): FinancialAgentResults {
  return defaultFinancialAgents.run(input);
}
