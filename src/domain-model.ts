export type TransactionSource = 'bank' | 'card';

/* Which card a report came from, as the customer answered it — no issuer export states it.
   It is provenance, shown on the row and kept so the question is not asked twice; it does
   not decide reconciliation. Every card in this market settles by debiting the account, so
   a settlement line stands on the statement whoever issued the card, and card detail is the
   same money described twice in both cases. Absent on rows imported before the question
   was asked. */
export type CardIssuer = 'bank' | 'external';
export type CategoryKind = 'expense' | 'income' | 'neutral';

export interface BankTransaction {
  date: string;
  vdate: string;
  ref: string;
  desc: string;
  out: number;
  in: number;
  bal: number | null;
  pending: boolean;
  source?: TransactionSource;
  cardKind?: CardIssuer;
  src: string;
  id?: string;
  cat?: string;
  kind?: CategoryKind;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
}

export interface Rule {
  id: string;
  match: string;
  cat: string;
}

export interface AppState {
  tx: BankTransaction[];
  overrides: Record<string, string>;
  rules: Rule[];
  cats: Category[];
  budgets: Record<string, number>;
  accounts: string[];
  month: string | null;
}
