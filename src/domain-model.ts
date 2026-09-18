export type TransactionSource = 'bank' | 'card';

/* Which card a report came from, as the customer answered it — no issuer export states it.
   It is provenance, shown on the row and kept so the question is not asked twice; it does
   not decide reconciliation. Every card in this market settles by debiting the account, so
   a settlement line stands on the statement whoever issued the card, and card detail is the
   same money described twice in both cases. Absent on rows imported before the question
   was asked. */
export type CardIssuer = 'bank' | 'external';

/* Which company issued the card, as the customer answered it — an issuer's export names
   the merchant, never itself, so the file cannot say. Separate from CardIssuer because the
   two answer different questions: a Visa is issued both by a bank and by a credit company,
   so the brand does not decide who settles it. 'other' is the customer declining to say;
   absent means the row was imported before the question was asked. Provenance only — it
   decides nothing about categorisation or reconciliation. */
export type CardBrand = 'visa' | 'cal' | 'isracard' | 'diners' | 'amex' | 'max' | 'leumi' | 'other';
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
  cardBrand?: CardBrand;
  /* The last four digits of the card a report came from, as the customer typed them at
     import. Two Visas are two cards and no export says which is which — the issuer names
     the company, not the card. Four digits are what every receipt prints and what a
     household recognises its own card by; the field accepts nothing else, so it cannot
     hold a card number, an account number or an IBAN however they are typed. Absent on
     every row imported before it was asked for, and on every row left blank. */
  cardLast4?: string;
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
  /* Which direction the rule reads, when the same wording means opposite things on the
     two sides of a statement — 'ביטוח לאומי' is an allowance arriving and a contribution
     leaving. Omitted on nearly every rule, and an omitted `when` matches both. */
  when?: 'in' | 'out';
}

/* A goal the household set for itself: what it is saving towards, how much it has put
   aside so far and by when. Both figures are the household's own — no statement says which
   transfer belonged to which goal, so the app never infers them. Stored like a budget cap,
   because it is the same kind of thing: an output the customer approved, not a finding. */
export interface SavingsGoal {
  id: string;
  name: string;
  target: number;
  saved: number;
  /** 'YYYY-MM', or null for a goal with no date on it. */
  due: string | null;
}

export interface AppState {
  tx: BankTransaction[];
  overrides: Record<string, string>;
  rules: Rule[];
  cats: Category[];
  budgets: Record<string, number>;
  goals: SavingsGoal[];
  accounts: string[];
  month: string | null;
}
