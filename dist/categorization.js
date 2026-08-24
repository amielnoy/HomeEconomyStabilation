export class RuleBasedTransactionCategorizer {
    categorize(transaction, overrides, rules) {
        const override = transaction.id ? overrides[transaction.id] : undefined;
        if (override)
            return override;
        const description = transaction.desc.toLocaleLowerCase();
        const matched = rules.find((rule) => rule.match && description.includes(rule.match.toLocaleLowerCase()));
        if (matched)
            return matched.cat;
        return transaction.in > 0 ? 'income' : 'other';
    }
}
