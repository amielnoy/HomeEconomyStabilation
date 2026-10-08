import type { BankTransaction } from './domain-model.js';

export function mergeSyncedTransactions(
  existing: readonly BankTransaction[], incoming: readonly BankTransaction[],
): { merged: BankTransaction[]; added: number; duplicates: number } {
  const have = new Set(existing.map((t) => t.id).filter((id): id is string => Boolean(id)));
  const merged = [...existing];
  let added = 0, duplicates = 0;
  for (const transaction of incoming) {
    if (transaction.id && have.has(transaction.id)) { duplicates++; continue; }
    if (transaction.id) have.add(transaction.id);
    merged.push(transaction);
    added++;
  }
  return { merged, added, duplicates };
}
