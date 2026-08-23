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
  balance: number;
  nextIncomeDate: string | null;
  committed: number;
  freeToSpend: number;
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
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentile75 = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * .75) - 1];
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
    map.set(key, [...(map.get(key) || []), transaction]);
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
    const categories = new Set(items.map((item) => overrides[item.id!]));
    if (items.length < 2 || categories.size !== 1 || match.length < 3) continue;
    const categoryId = [...categories][0];
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
  if (!transactions.length) return [];
  const asOf = [...transactions].sort((a, b) => dateValue(b.date) - dateValue(a.date))[0].date;
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
      const days = Math.round((dateValue(second.date) - dateValue(first.date)) / DAY);
      const tolerance = Math.max(1, first.out * .005);
      if (days >= 1 && days <= 5 && Math.abs(first.out - second.out) <= tolerance) {
        findings.push({ merchant, amount: second.out, firstDate: first.date, secondDate: second.date });
      }
    }
  }
  return findings;
}

export function subscriptionAgent(transactions: AgentTransaction[]): SubscriptionFinding[] {
  const findings: SubscriptionFinding[] = [];
  for (const [merchant, items] of groups(transactions.filter((item) => item.out > 0 && item.out <= 600))) {
    const sorted = [...items].sort((a, b) => dateValue(a.date) - dateValue(b.date));
    if (new Set(sorted.map((item) => monthKey(item.date))).size < 3) continue;
    const previous = sorted.slice(0, -1).map((item) => item.out);
    const monthly = median(sorted.map((item) => item.out));
    const spread = Math.max(...sorted.map((item) => item.out)) - Math.min(...sorted.map((item) => item.out));
    if (!monthly || spread / monthly > .35) continue;
    const oldBaseline = previous.length ? median(previous) : monthly;
    const increasePercent = oldBaseline ? Math.max(0, Math.round(((sorted.at(-1)!.out - oldBaseline) / oldBaseline) * 100)) : 0;
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

export function paydayAgent(transactions: AgentTransaction[]): PaydayRunway | null {
  const withBalance = transactions.filter((item) => item.bal != null).sort((a, b) => dateValue(b.date) - dateValue(a.date));
  if (!withBalance.length) return null;
  const latest = withBalance[0];
  const latestTime = dateValue(latest.date);
  const recurringIncome = [...groups(transactions.filter((item) => item.in > 0)).entries()]
    .filter(([, items]) => new Set(items.map((item) => monthKey(item.date))).size >= 2)
    .sort((a, b) => median(b[1].map((item) => item.in)) - median(a[1].map((item) => item.in)))[0];
  if (!recurringIncome) return {
    balance: latest.bal!, nextIncomeDate: null, committed: 0, freeToSpend: latest.bal!,
    daysRemaining: null, dailyAllowance: null, weeklyAllowance: null,
  };
  const expectedDay = Math.round(median(recurringIncome[1].map((item) => dayOfMonth(item.date))));
  const cursor = new Date(`${latest.date}T00:00:00Z`);
  let nextIncome = dateAtMonthDay(cursor.getUTCFullYear(), cursor.getUTCMonth(), expectedDay);
  if (nextIncome.getTime() <= latestTime) nextIncome = dateAtMonthDay(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, expectedDay);
  const committed = [...groups(transactions.filter((item) => item.out > 0)).values()]
    .filter((items) => new Set(items.map((item) => monthKey(item.date))).size >= 2)
    .reduce((sum, items) => {
      const dueDay = Math.round(median(items.map((item) => dayOfMonth(item.date))));
      let due = dateAtMonthDay(cursor.getUTCFullYear(), cursor.getUTCMonth(), dueDay);
      if (due.getTime() <= latestTime) due = dateAtMonthDay(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, dueDay);
      return due < nextIncome ? sum + median(items.map((item) => item.out)) : sum;
    }, 0);
  const freeToSpend = latest.bal! - committed;
  const daysRemaining = Math.max(1, Math.ceil((nextIncome.getTime() - latestTime) / DAY));
  const dailyAllowance = freeToSpend / daysRemaining;
  return {
    balance: latest.bal!, nextIncomeDate: nextIncome.toISOString().slice(0, 10), committed,
    freeToSpend, daysRemaining, dailyAllowance, weeklyAllowance: dailyAllowance * 7,
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
