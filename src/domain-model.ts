export type TransactionSource = 'bank' | 'card';
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
