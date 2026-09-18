import { describe, expect, it } from 'vitest';
import { goalProgress, orderGoals } from '../../src/savings-goals';
import type { SavingsGoal } from '../../src/domain-model';

/* A goal carries two figures the household typed and one date. Everything the screen adds
   is arithmetic on those three — and the arithmetic is where a budgeting screen usually
   goes wrong: a division by a target of zero, a month count that went negative, a
   percentage past 100, a monthly figure of Infinity shown as money. */

const goal = (input: Partial<SavingsGoal> = {}): SavingsGoal =>
  ({ id: 'g1', name: 'טיול', target: 12000, saved: 3000, due: null, ...input });

const september = new Date(Date.UTC(2026, 8, 18));

describe('savings goal progress', () => {
  it('reports the share saved and what is left', () => {
    const progress = goalProgress(goal(), september);

    expect(progress.share).toBeCloseTo(0.25, 4);
    expect(progress.remaining).toBe(9000);
    expect(progress.done).toBe(false);
  });

  /* The target month is a month, not a day: a goal due in July has July to be reached in,
     so a household saving monthly gets that month too. */
  it('spreads what is left over the months up to and including the target month', () => {
    const progress = goalProgress(goal({ due: '2027-07' }), september);

    expect(progress.monthsLeft).toBe(11);
    expect(progress.monthlyNeed).toBeCloseTo(9000 / 11, 4);
  });

  it('asks nothing more of a goal already reached', () => {
    const progress = goalProgress(goal({ saved: 12000, due: '2027-07' }), september);

    expect(progress).toMatchObject({ done: true, remaining: 0, share: 1, monthlyNeed: null, overdue: false });
  });

  /* Money past the target is money past the target — a bar at 130% and a negative
     remainder would both read as something still to do. */
  it('stops at full for a goal that was oversaved', () => {
    const progress = goalProgress(goal({ saved: 15000 }), september);

    expect(progress.share).toBe(1);
    expect(progress.remaining).toBe(0);
    expect(progress.done).toBe(true);
  });

  /* A target month gone is not a month to divide by. Saying "0 ₪ a month" about a goal
     that is behind would read as nothing left to do; the remainder is said once instead. */
  it('names a passed target month instead of dividing by the months it has left', () => {
    const progress = goalProgress(goal({ due: '2026-03' }), september);

    expect(progress.overdue).toBe(true);
    expect(progress.monthsLeft).toBe(0);
    expect(progress.monthlyNeed).toBe(9000);
  });

  it('gives the current month one month to be reached in', () => {
    const progress = goalProgress(goal({ due: '2026-09' }), september);

    expect(progress.monthsLeft).toBe(1);
    expect(progress.monthlyNeed).toBe(9000);
    expect(progress.overdue).toBe(false);
  });

  it.each([
    ['a target of zero', goal({ target: 0, saved: 0 })],
    ['a target that is not a number', goal({ target: Number.NaN })],
    ['a target that is infinite', goal({ target: Number.POSITIVE_INFINITY })],
    ['a negative amount saved', goal({ saved: -500 })],
  ])('never turns %s into a percentage or a monthly figure it cannot show', (_label, input) => {
    const progress = goalProgress({ ...input, due: '2027-07' }, september);

    expect(Number.isFinite(progress.share)).toBe(true);
    expect(progress.share).toBeGreaterThanOrEqual(0);
    expect(progress.share).toBeLessThanOrEqual(1);
    expect(Number.isFinite(progress.remaining)).toBe(true);
    expect(progress.monthlyNeed === null || Number.isFinite(progress.monthlyNeed)).toBe(true);
  });

  it('leaves a goal with no target month without a monthly figure to act on', () => {
    const progress = goalProgress(goal(), september);

    expect(progress.monthsLeft).toBeNull();
    expect(progress.monthlyNeed).toBeNull();
  });

  it.each(['2026', 'July 2027', '2026-13-01', ''])('treats %s as a goal with no target month', (due) => {
    expect(goalProgress(goal({ due }), september).monthsLeft).toBeNull();
  });
});

describe('the order goals are worked through in', () => {
  /* What is still open comes first, nearest target month at the top, so the goal that asks
     something of this month is the one at eye level. A goal reached sinks rather than
     disappearing: it is the household's evidence that the screen works. */
  it('puts the open goals first, nearest month at the top, and reached ones last', () => {
    const ordered = orderGoals([
      { id: 'a', name: 'רכב', target: 60000, saved: 60000, due: '2026-12' },
      { id: 'b', name: 'טיול', target: 12000, saved: 3000, due: '2027-07' },
      { id: 'c', name: 'חירום', target: 20000, saved: 1000, due: '2026-11' },
      { id: 'd', name: 'בלי תאריך', target: 5000, saved: 0, due: null },
    ], september);

    expect(ordered.map((item) => item.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('does not change the list it was given', () => {
    const goals = [goal({ id: 'a', due: '2027-07' }), goal({ id: 'b', saved: 12000 })];
    orderGoals(goals, september);

    expect(goals.map((item) => item.id)).toEqual(['a', 'b']);
  });
});
