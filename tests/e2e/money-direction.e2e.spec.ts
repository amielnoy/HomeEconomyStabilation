import { expect, test } from './fixtures';

/* Which way the money went is the first thing a household reads off a row, and the page
   used to say it in a palette meant for charts: the dot carried the category's slot
   colour — the third slot a green close to the income green, everything past the eighth
   the grey that also means "other" — and the recurring table drew its amounts in the same
   ink as the day of the month. Spending is red and carries its minus; money arriving is
   green; a transfer between the household's own accounts is neutral. */

const statement = () => ({
  name: 'bank.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך,תיאור פעולה,חובה,זכות,יתרה',
    '02/08/2026,משכורת,,10000,12000',
    '12/08/2026,שופרסל דיל,400,,11600',
    '02/09/2026,משכורת,,10000,21600',
    '12/09/2026,שופרסל דיל,400,,21200',
  ].join('\n')),
});

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('draws the dot in the colour of the money, not of the category slot', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());

  const dotOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).first().getByTestId('transaction-flow-dot');
  const leaving = await homePage.dashboard.resolvedColour('--crit');
  const arriving = await homePage.dashboard.resolvedColour('--good');

  await expect(dotOf('שופרסל דיל')).toHaveCSS('background-color', leaving);
  await expect(dotOf('משכורת')).toHaveCSS('background-color', arriving);
  expect(leaving).not.toBe(arriving);
});

test('writes a charge as a red minus and money arriving as a green plus', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());

  const amountOf = (merchant: string) => homePage.dashboard.transactionRows
    .filter({ hasText: merchant }).first().getByTestId('transaction-amount');
  const spent = await homePage.dashboard.resolvedColour('--crit-text');
  const received = await homePage.dashboard.resolvedColour('--good-text');

  await expect(amountOf('שופרסל דיל')).toHaveText(/^\D*-400\.00/);
  await expect(amountOf('שופרסל דיל')).toHaveCSS('color', spent);
  await expect(amountOf('משכורת')).toHaveText(/^\D*\+10,000\.00/);
  await expect(amountOf('משכורת')).toHaveCSS('color', received);
});

/* The recurring table answers "what leaves every month" — and drew every figure in the
   same ink, so the household bills and the salary looked alike in the one place built to
   tell them apart. */
test('colours the recurring charges by direction too', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());

  const rowFor = (merchant: string) => homePage.dashboard.recurringRows
    .filter({ hasText: merchant }).getByTestId('recurring-amount');
  const spent = await homePage.dashboard.resolvedColour('--crit-text');
  const received = await homePage.dashboard.resolvedColour('--good-text');

  await expect(rowFor('שופרסל דיל')).toHaveText(/^\D*-400\.00/);
  await expect(rowFor('שופרסל דיל')).toHaveCSS('color', spent);
  await expect(rowFor('משכורת')).toHaveCSS('color', received);
});

/* "לאן הכסף הולך" lists nothing but money that left, and listed it as plain black numbers
   with no sign — so a household scanning the page saw its spending written in the same
   ink and the same shape as the salary that carries a plus. Every figure in the breakdown
   and in its table is a charge, and is written as one. */
test('writes every figure in the spending breakdown as a red charge', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());
  const spent = await homePage.dashboard.resolvedColour('--crit-text');

  await expect(homePage.dashboard.categoryAmounts.first()).toHaveText(/^\D*-400\.00/);
  for (const amount of await homePage.dashboard.categoryAmounts.all()) {
    await expect(amount).toHaveCSS('color', spent);
    await expect(amount).toHaveText(/-/);
  }

  await homePage.dashboard.categoryTableToggle.click();
  for (const amount of await homePage.dashboard.categoryTableAmounts.all()) {
    await expect(amount).toHaveCSS('color', spent);
    await expect(amount).toHaveText(/-/);
  }
});

/* A charge that announced itself in the amount cell and looked ordinary in the other five
   was read as ordinary. A household scans a month by the line, so the line carries it. */
test('colours a whole outgoing row, not only its amount', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());
  const spent = await homePage.dashboard.resolvedColour('--crit-text');

  const spending = homePage.dashboard.transactionRows.filter({ hasText: 'שופרסל דיל' });
  for (const cell of await spending.locator('td').all()) {
    await expect(cell).toHaveCSS('color', spent);
  }
});

/* Money arriving is not spending and must not be dressed as it. */
test('leaves a row that brought money in uncoloured', async ({ homePage }) => {
  await homePage.upload.uploadBankReport(statement());
  const spent = await homePage.dashboard.resolvedColour('--crit-text');

  const arriving = homePage.dashboard.transactionRows.filter({ hasText: 'משכורת' });
  await expect(arriving.locator('td').first()).not.toHaveCSS('color', spent);
});
