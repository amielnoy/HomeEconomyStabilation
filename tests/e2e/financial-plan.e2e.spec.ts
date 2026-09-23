import { expect, test } from './fixtures';

/* A household sitting down with a מיפוי worksheet fills in four things by hand: what came
   in, what leaves whether or not anyone decides it this month, what it decided this month,
   and what it set aside. The screen fills them from the statements already imported, so
   every figure traces back to a row and none of them is a target the app invented. */

const twoMonths = () => ({
  name: 'bank.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך,תיאור פעולה,חובה,זכות,יתרה',
    '02/08/2026,משכורת,,29000,29000',
    '03/08/2026,ארנונה עיריית חיפה,1240,,27760',
    '05/08/2026,נטפליקס,54.90,,27705',
    '02/09/2026,משכורת,,29000,56705',
    '03/09/2026,ארנונה עיריית חיפה,1240,,55465',
    '04/09/2026,קצבת ילדים,,1200,56665',
    '05/09/2026,נטפליקס,54.90,,56610',
    '06/09/2026,שופרסל דיל,412.30,,56198',
    '08/09/2026,העברה לחיסכון,2000,,54198',
  ].join('\n')),
});

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('reads the month as income, what leaves, what was chosen and what was set aside', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(twoMonths());

  await expect(homePage.dashboard.planIncome).toContainText('+30,200.00');
  // ארנונה and נטפליקס both stood in August, so September's are commitments, not choices.
  await expect(homePage.dashboard.planFixed).toContainText('-1,294.90');
  await expect(homePage.dashboard.planVariable).toContainText('-412.30');
  await expect(homePage.dashboard.planSavings).toContainText('-2,000.00');
});

/* Salary and a children's allowance are both filed as income. One line called "הכנסות"
   would tell a household nothing about where its money comes from. */
test('names each income line by where the money came from', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(twoMonths());

  await expect(homePage.dashboard.planIncome).toContainText('משכורת');
  await expect(homePage.dashboard.planIncome).toContainText('קצבת ילדים');
});

/* A charge is fixed because the same business came before — the answer the recurring
   agent already gives. A first-time charge is a choice the household made this month. */
test('moves a charge to fixed only once the same business has stood in an earlier month', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'one-month.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,זכות,יתרה',
      '02/09/2026,משכורת,,9000,9000',
      '03/09/2026,נטפליקס,54.90,,8945',
    ].join('\n')),
  });

  await expect(homePage.dashboard.planVariable).toContainText('-54.90');
  await expect(homePage.dashboard.planFixed).toContainText('אין תנועות בחלק הזה החודש');
});

/* Money moved to savings is not spent, but it is not available either. Counting it as
   neither would report a surplus the household cannot touch. */
test('counts money set aside against what is left over', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(twoMonths());

  // 30,200 in, 1,294.90 + 412.30 committed and chosen, 2,000 set aside.
  await expect(homePage.dashboard.planSurplus).toHaveText(/\+26,492\.80/);
});

/* A month that spent more than it earned is named, not handed to the reader as a negative
   number sitting where money to spend goes. */
test('calls a month that spent more than it earned a shortfall', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'short.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,זכות,יתרה',
      '02/09/2026,משכורת,,4000,4000',
      '03/09/2026,משכנתא,6000,,-2000',
    ].join('\n')),
  });

  await expect(homePage.dashboard.planBottom).toContainText('חסר החודש');
  await expect(homePage.dashboard.planSurplus).toHaveText(/-2,000\.00/);
});

/* Income and spending are two lengths to compare, not two parts of one whole, and the
   comparison has to be readable without seeing colour. */
test('compares income against spending in a figure that names both', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(twoMonths());

  await expect(homePage.dashboard.planBar).toHaveAttribute('aria-label', /30,200[\s\S]*3,707/);
});

test('offers the plan in every language', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(twoMonths());

  for (const [locale, heading] of [
    ['en', 'Financial plan'], ['fr', 'Plan financier'], ['he', 'תכנית כלכלית'],
  ] as const) {
    await homePage.language.choose(locale);
    await expect(homePage.page.getByTestId('plan-h')).toHaveText(heading);
  }
});

/* The settlement line on the statement and the card's own charges are the same money
   described twice. Counted in the plan's totals as well as in the spending sections, a
   household's card bill is added to its month a second time and what is left over comes
   out short by the whole bill — on this screen the figure was 4,812.37 ₪ off. */
test('leaves a settled card bill out of the month it already counted', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'with-card.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,זכות,יתרה',
      '02/09/2026,משכורת,,29000,29000',
      '03/09/2026,ארנונה עיריית חיפה,1240,,27760',
      '06/09/2026,ויזה כ.א.ל,4812.37,,22948',
    ].join('\n')),
  });
  await homePage.upload.uploadCreditCardReport({
    name: 'card.csv', mimeType: 'text/csv',
    buffer: Buffer.from(['תאריך העסקה,שם בית העסק,סכום החיוב', '04/09/2026,סופר יוחננוף,412.30'].join('\n')),
  }, 'external', 'visa');

  // 29,000 in, 1,240 + 412.30 out. The 4,812.37 settlement paid for the 412.30.
  await expect(homePage.dashboard.planSurplus).toHaveText(/\+27,347\.70/);
  await expect(homePage.dashboard.planSettlement).toContainText('-4,812.37');
  await expect(homePage.dashboard.planSettlement).toContainText('לא נספר בסיכום');
  // And it is not filed as money the household chose to set aside.
  await expect(homePage.dashboard.planSavings).toContainText('אין תנועות בחלק הזה החודש');
});

/* Without a card report the settlement is the only record of that spending, so it counts. */
test('counts a card bill that nothing itemises', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'no-card.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,זכות,יתרה',
      '02/09/2026,משכורת,,29000,29000',
      '06/09/2026,ויזה כ.א.ל,4812.37,,24188',
    ].join('\n')),
  });

  await expect(homePage.dashboard.planSurplus).toHaveText(/\+24,187\.63/);
  await expect(homePage.dashboard.planSettlement).toHaveCount(0);
});

/* A section the month left empty shows a plain zero: money2S signs everything it is given,
   and "+0.00 ₪" at the head of an expense section reads as money that arrived. */
test('heads an empty spending section with a plain zero', async ({ homePage }) => {
  await homePage.upload.uploadBankReport({
    name: 'one-row.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,זכות,יתרה',
      '02/09/2026,משכורת,,29000,29000',
    ].join('\n')),
  });

  await expect(homePage.dashboard.planFixed).toContainText('0.00');
  await expect(homePage.dashboard.planFixed).not.toContainText('+0.00');
});

/* What leaves is what a household opens the plan for. The two spending headings are set
   apart from the rest of it — larger, heavier and in the colour this app already spends in
   — while the words themselves still carry the meaning for anyone who cannot see colour. */
test('sets the two spending headings apart from the rest of the plan', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(twoMonths());

  const income = await homePage.dashboard.planHeadingStyle(homePage.dashboard.planIncome);
  for (const section of [homePage.dashboard.planFixed, homePage.dashboard.planVariable]) {
    const spending = await homePage.dashboard.planHeadingStyle(section);
    expect(spending.size).toBeGreaterThan(income.size);
    expect(spending.weight).toBeGreaterThan(income.weight);
    expect(spending.color).not.toBe(income.color);
  }
});
