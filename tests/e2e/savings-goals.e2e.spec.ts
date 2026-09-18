import { expect, test } from './fixtures';

/* A household saving towards something has one question the statements cannot answer: am
   I putting enough aside to get there. Nothing on the page knew what "there" was. A goal
   is the household's own figures — no statement says which transfer belonged to which
   goal — and what the screen adds is the arithmetic nobody wants to do every month. */

const statement = () => ({
  name: 'bank.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך,תיאור פעולה,חובה,זכות,יתרה',
    '02/09/2026,משכורת,,29000,29000',
    '03/09/2026,ארנונה עיריית חיפה,1240,,27760',
  ].join('\n')),
});

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
  await homePage.upload.uploadBankReport(statement());
});

test('says what a goal still needs and what that asks of a month', async ({ homePage }) => {
  await homePage.dashboard.createGoal({ name: 'טיול משפחתי', target: 12000, saved: 3000, due: '2027-07' });

  await expect(homePage.dashboard.goalShares.first()).toHaveText('25%');
  await expect(homePage.dashboard.goalStatuses.first()).toContainText('9,000.00');
  await expect(homePage.dashboard.goalStatuses.first()).toContainText('יולי 2027');
});

test('marks a goal that has been reached instead of asking for more', async ({ homePage }) => {
  await homePage.dashboard.createGoal({ name: 'קרן חירום', target: 20000, saved: 20000 });

  await expect(homePage.dashboard.goalShares.first()).toHaveText('100%');
  await expect(homePage.dashboard.goalStatuses.first()).toContainText('הושלמה');
});

/* Money past the target is money past the target. A bar past full, or a remainder below
   zero, would both read as something still to do. */
test('stops at full for a goal that was oversaved', async ({ homePage }) => {
  await homePage.dashboard.createGoal({ name: 'רכב', target: 10000, saved: 14000 });

  await expect(homePage.dashboard.goalShares.first()).toHaveText('100%');
});

/* The goal that asks something of this month belongs at eye level; one already reached is
   kept as the household's evidence that the screen works, at the bottom. */
test('works through the open goals first and keeps a reached one at the bottom', async ({ homePage }) => {
  await homePage.dashboard.createGoal({ name: 'הושלמה', target: 1000, saved: 1000 });
  await homePage.dashboard.createGoal({ name: 'פתוחה', target: 5000, saved: 100, due: '2026-12' });

  await expect(homePage.dashboard.goalRows.first()).toContainText('פתוחה');
  await expect(homePage.dashboard.goalRows.last()).toContainText('הושלמה');
});

test('keeps a goal and its figures across a reload', async ({ homePage, page }) => {
  await homePage.dashboard.createGoal({ name: 'טיול משפחתי', target: 12000, saved: 3000, due: '2027-07' });

  await page.reload();

  await expect(homePage.dashboard.goalRows).toHaveCount(1);
  await expect(homePage.dashboard.goalRows.first()).toContainText('טיול משפחתי');
  await expect(homePage.dashboard.goalShares.first()).toHaveText('25%');
});

test('removes a goal the household is done with', async ({ homePage }) => {
  await homePage.dashboard.createGoal({ name: 'טיול משפחתי', target: 12000, saved: 3000 });
  await expect(homePage.dashboard.goalRows).toHaveCount(1);

  await homePage.dashboard.goalRows.first().getByTestId('goal-remove').click();

  await expect(homePage.dashboard.goalRows).toHaveCount(0);
  await expect(homePage.dashboard.goals).toContainText('עדיין לא הוגדרו מטרות');
});

/* A name is free text, and a household that pastes an account number into one must not
   have it kept — the same rule a merchant description follows. */
test('does not keep an account number typed into a goal name', async ({ homePage, page }) => {
  await homePage.dashboard.createGoal({ name: 'חיסכון 12-345-6789012', target: 5000, saved: 0 });

  await page.reload();

  const stored = await page.evaluate(() => window.localStorage.getItem('mazan-habait/v1') ?? '');
  expect(stored).not.toContain('6789012');
  expect(stored).toContain('redacted');
});

test('offers the goals section in every language', async ({ homePage, page }) => {
  for (const [locale, heading] of [
    ['en', 'Savings goals'], ['fr', 'Objectifs d’épargne'], ['he', 'מטרות חיסכון'],
  ] as const) {
    await homePage.language.choose(locale);
    await expect(page.getByTestId('goals-h')).toHaveText(heading);
  }
});
