import type { SavingsGoal } from './domain-model.js';

/* What a household is saving towards, and what that asks of it this month. The target and
   what has been put aside so far are the household's own figures — nothing here infers
   them from transactions, because no statement says which transfer belonged to which
   goal, and a progress bar built on a guess is worse than no progress bar. */
export interface GoalProgress {
  readonly id: string;
  /** 0..1, clamped: a goal passed is full, never more, and a target of zero is not a
      division the screen is allowed to perform. */
  readonly share: number;
  readonly remaining: number;
  /** Whole months from this month to the target month inclusive; null with no target
      month, 0 once that month has passed. */
  readonly monthsLeft: number | null;
  /** What reaching the target asks of this month. Null when there is no target month, or
      nothing left to save — a figure the household cannot act on is not shown. */
  readonly monthlyNeed: number | null;
  readonly done: boolean;
  readonly overdue: boolean;
}

const monthKeyOf = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

/* Counted on month boundaries rather than on days: a goal due in March is due by the end
   of March, and a household saving monthly has that month to do it in. */
const monthsBetween = (from: string, to: string): number => {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  if (!fromYear || !fromMonth || !toYear || !toMonth) return 0;
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
};

export function goalProgress(goal: SavingsGoal, today: Date): GoalProgress {
  const target = Number.isFinite(goal.target) && goal.target > 0 ? goal.target : 0;
  const saved = Number.isFinite(goal.saved) && goal.saved > 0 ? goal.saved : 0;
  const remaining = Math.max(target - saved, 0);
  const done = target > 0 && remaining === 0;
  const share = target > 0 ? Math.min(saved / target, 1) : 0;

  if (!goal.due || !/^\d{4}-\d{2}$/.test(goal.due)) {
    return { id: goal.id, share, remaining, monthsLeft: null, monthlyNeed: null, done, overdue: false };
  }
  const distance = monthsBetween(monthKeyOf(today), goal.due);
  const monthsLeft = Math.max(distance + 1, 0);
  const overdue = !done && distance < 0;
  /* A target month already gone is not a month to spread the remainder over. What is left
     is what this month is short by, said once, rather than divided by a zero. */
  const monthlyNeed = done ? null : monthsLeft > 0 ? remaining / monthsLeft : remaining;
  return { id: goal.id, share, remaining, monthsLeft, monthlyNeed, done, overdue };
}

/** Goals in the order a household would work through them: what is still open first, and
    within that the nearest target month, so the one that asks something of this month is
    at the top. A goal reached sinks to the bottom rather than disappearing. */
export function orderGoals(goals: readonly SavingsGoal[], today: Date): SavingsGoal[] {
  return [...goals].sort((first, second) => {
    const firstProgress = goalProgress(first, today);
    const secondProgress = goalProgress(second, today);
    if (firstProgress.done !== secondProgress.done) return firstProgress.done ? 1 : -1;
    if (first.due && second.due && first.due !== second.due) return first.due < second.due ? -1 : 1;
    if (first.due !== second.due) return first.due ? -1 : 1;
    return second.target - first.target;
  });
}
