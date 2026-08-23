const DAY = 86_400_000;
const dateValue = (date) => new Date(`${date}T00:00:00Z`).getTime();
const monthKey = (date) => date.slice(0, 7);
const dayOfMonth = (date) => Number(date.slice(8, 10));
const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentile75 = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil(sorted.length * .75) - 1];
};
export function merchantKey(description) {
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
function groups(transactions) {
    const map = new Map();
    for (const transaction of transactions) {
        const key = merchantKey(transaction.desc);
        if (!key)
            continue;
        map.set(key, [...(map.get(key) || []), transaction]);
    }
    return map;
}
export function learningAgent(transactions, overrides, rules) {
    const manuallyClassified = transactions.filter((transaction) => transaction.id && overrides[transaction.id]);
    for (const [match, items] of groups(manuallyClassified)) {
        const categories = new Set(items.map((item) => overrides[item.id]));
        if (items.length < 2 || categories.size !== 1 || match.length < 3)
            continue;
        const categoryId = [...categories][0];
        if (rules.some((rule) => rule.cat === categoryId && merchantKey(rule.match) === match))
            continue;
        return { match, categoryId, examples: items.slice(0, 3).map((item) => item.desc) };
    }
    return null;
}
export function anomalyAgent(transactions) {
    const findings = [];
    for (const [merchant, items] of groups(transactions.filter((item) => item.out > 0))) {
        const sorted = [...items].sort((a, b) => dateValue(a.date) - dateValue(b.date));
        if (new Set(sorted.map((item) => monthKey(item.date))).size < 3)
            continue;
        const latest = sorted.at(-1);
        const history = sorted.slice(0, -1).map((item) => item.out).filter((amount) => amount > 0);
        if (history.length < 2)
            continue;
        const baseline = median(history);
        const percent = baseline ? Math.round(((latest.out - baseline) / baseline) * 100) : 0;
        if (percent >= 30 && latest.out > Math.max(...history) * 1.15) {
            findings.push({ merchant, latest: latest.out, baseline, percent });
        }
    }
    return findings.sort((a, b) => b.percent - a.percent);
}
export function missingChargeAgent(transactions) {
    if (!transactions.length)
        return [];
    const asOf = [...transactions].sort((a, b) => dateValue(b.date) - dateValue(a.date))[0].date;
    const currentMonth = monthKey(asOf);
    const currentDay = dayOfMonth(asOf);
    const findings = [];
    for (const [merchant, items] of groups(transactions.filter((item) => item.out > 0 || item.in > 0))) {
        const byMonth = new Set(items.map((item) => monthKey(item.date)));
        if (byMonth.size < 2 || byMonth.has(currentMonth))
            continue;
        const expectedDay = Math.round(median(items.map((item) => dayOfMonth(item.date))));
        if (currentDay < expectedDay + 4)
            continue;
        const incoming = items.filter((item) => item.in > 0).length > items.length / 2;
        const amounts = items.map((item) => incoming ? item.in : item.out).filter(Boolean);
        findings.push({ merchant, amount: median(amounts), direction: incoming ? 'in' : 'out', expectedDay });
    }
    return findings;
}
export function duplicateAgent(transactions) {
    const findings = [];
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
export function subscriptionAgent(transactions) {
    const findings = [];
    for (const [merchant, items] of groups(transactions.filter((item) => item.out > 0 && item.out <= 600))) {
        const sorted = [...items].sort((a, b) => dateValue(a.date) - dateValue(b.date));
        if (new Set(sorted.map((item) => monthKey(item.date))).size < 3)
            continue;
        const previous = sorted.slice(0, -1).map((item) => item.out);
        const monthly = median(sorted.map((item) => item.out));
        const spread = Math.max(...sorted.map((item) => item.out)) - Math.min(...sorted.map((item) => item.out));
        if (!monthly || spread / monthly > .35)
            continue;
        const oldBaseline = previous.length ? median(previous) : monthly;
        const increasePercent = oldBaseline ? Math.max(0, Math.round(((sorted.at(-1).out - oldBaseline) / oldBaseline) * 100)) : 0;
        findings.push({ merchant, monthly, annual: monthly * 12, increasePercent });
    }
    return findings.sort((a, b) => b.annual - a.annual);
}
export function budgetAgent(transactions, categories) {
    const recentMonths = [...new Set(transactions.map((item) => monthKey(item.date)))].sort().reverse().slice(0, 3);
    return categories.filter((category) => category.kind === 'expense').flatMap((category) => {
        const totals = recentMonths.map((month) => transactions
            .filter((item) => monthKey(item.date) === month && item.cat === category.id)
            .reduce((sum, item) => sum + item.out, 0));
        if (!totals.some((total) => total > 0))
            return [];
        const suggested = Math.max(50, Math.ceil(percentile75(totals) / 50) * 50);
        return [{ categoryId: category.id, suggested, months: recentMonths.length }];
    });
}
export function paydayAgent(transactions) {
    const withBalance = transactions.filter((item) => item.bal != null).sort((a, b) => dateValue(b.date) - dateValue(a.date));
    if (!withBalance.length)
        return null;
    const latest = withBalance[0];
    const latestTime = dateValue(latest.date);
    const recurringIncome = [...groups(transactions.filter((item) => item.in > 0)).entries()]
        .filter(([, items]) => new Set(items.map((item) => monthKey(item.date))).size >= 2)
        .sort((a, b) => median(b[1].map((item) => item.in)) - median(a[1].map((item) => item.in)))[0];
    if (!recurringIncome)
        return { balance: latest.bal, nextIncomeDate: null, committed: 0, freeToSpend: latest.bal };
    const expectedDay = Math.round(median(recurringIncome[1].map((item) => dayOfMonth(item.date))));
    const cursor = new Date(`${latest.date}T00:00:00Z`);
    let nextIncome = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), expectedDay));
    if (nextIncome.getTime() <= latestTime)
        nextIncome = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, expectedDay));
    const committed = [...groups(transactions.filter((item) => item.out > 0)).values()]
        .filter((items) => new Set(items.map((item) => monthKey(item.date))).size >= 2)
        .reduce((sum, items) => {
        const dueDay = Math.round(median(items.map((item) => dayOfMonth(item.date))));
        const due = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), dueDay));
        if (due.getTime() <= latestTime)
            due.setUTCMonth(due.getUTCMonth() + 1);
        return due < nextIncome ? sum + median(items.map((item) => item.out)) : sum;
    }, 0);
    return {
        balance: latest.bal, nextIncomeDate: nextIncome.toISOString().slice(0, 10), committed,
        freeToSpend: latest.bal - committed,
    };
}
export function runFinancialAgents(input) {
    const { transactions, overrides, rules, categories } = input;
    return {
        learning: learningAgent(transactions, overrides, rules),
        anomalies: anomalyAgent(transactions),
        missing: missingChargeAgent(transactions),
        duplicates: duplicateAgent(transactions),
        subscriptions: subscriptionAgent(transactions),
        budgetSuggestions: budgetAgent(transactions, categories),
        payday: paydayAgent(transactions),
    };
}
