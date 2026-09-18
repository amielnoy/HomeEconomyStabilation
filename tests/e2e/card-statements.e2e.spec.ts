import { expect, test } from './fixtures';

/* When a card bill arrives it has to be recognised before it is paid, and the dashboard's
   table answers a different question — what did the household spend, all sources at once.
   This screen is one card at a time, newest first, the way the issuer prints it. */

const statement = () => ({
  name: 'bank.csv', mimeType: 'text/csv',
  buffer: Buffer.from(['תאריך,תיאור פעולה,חובה,זכות,יתרה', '02/09/2026,משכורת,,29000,29000'].join('\n')),
});

const visa = () => ({
  name: 'visa.csv', mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך העסקה,שם בית העסק,סכום החיוב',
    '04/09/2026,סופר יוחננוף,412.30',
    '05/09/2026,נטפליקס,54.90',
  ].join('\n')),
});

const isracard = () => ({
  name: 'isra.csv', mimeType: 'text/csv',
  buffer: Buffer.from(['תאריך העסקה,שם בית העסק,סכום החיוב', '03/09/2026,מוסך הכרמל,900.00'].join('\n')),
});

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
  await homePage.upload.uploadBankReport(statement());
  await homePage.upload.uploadCreditCardReport(visa(), 'external', 'visa');
  await homePage.upload.uploadCreditCardReport(isracard(), 'bank', 'isracard');
  await homePage.dashboard.openCards();
});

test('lists every card charge and says how many cards it came from', async ({ homePage }) => {
  await expect(homePage.dashboard.cardChargeRows).toHaveCount(3);
  await expect(homePage.dashboard.cardsNote).toContainText('2');
  await expect(homePage.dashboard.cardsNote).toContainText('1,367');
});

/* The combo box names the cards, and choosing one leaves the others out — which is the
   whole point when a single issuer's bill is the thing being checked. */
test('shows one card at a time when a card is chosen', async ({ homePage, page }) => {
  await page.getByTestId('f-card').selectOption('isracard');

  await expect(homePage.dashboard.cardChargeRows).toHaveCount(1);
  await expect(homePage.dashboard.cardChargeRows.first()).toContainText('מוסך הכרמל');
  await expect(homePage.dashboard.cardChargeRows.first()).toContainText('ישראכרט');
});

test('names the cards in the combo box, sorted, with every card first', async ({ homePage, page }) => {
  const options = await page.getByTestId('f-card').locator('option').allInnerTexts();

  expect(options[0]).toBe('כל הכרטיסים');
  expect(options.slice(1)).toEqual([...options.slice(1)].sort((first, second) => first.localeCompare(second, 'he')));
  expect(options.slice(1)).toEqual(expect.arrayContaining(['ויזה', 'ישראכרט']));
});

test('prints each card newest first', async ({ homePage, page }) => {
  await page.getByTestId('f-card').selectOption('visa');

  await expect(homePage.dashboard.cardChargeRows.first()).toContainText('נטפליקס');
  await expect(homePage.dashboard.cardChargeRows.last()).toContainText('סופר יוחננוף');
});

/* A charge is money leaving whichever screen it is read on. */
test('writes every charge as a red minus', async ({ homePage }) => {
  const spent = await homePage.dashboard.resolvedColour('--crit-text');

  for (const amount of await homePage.dashboard.cardChargeAmounts.all()) {
    await expect(amount).toContainText('-');
    await expect(amount).toHaveCSS('color', spent);
  }
});

test('says so plainly when no card report has been imported', async ({ homePage, page }) => {
  await homePage.openFresh();
  await homePage.upload.uploadBankReport(statement());
  await homePage.dashboard.openCards();

  await expect(homePage.dashboard.cardChargeRows).toHaveCount(0);
  await expect(page.getByTestId('cards')).toContainText('אין חיובי כרטיס');
});

test('hides the dashboard while it is open and gives it back', async ({ homePage, page }) => {
  await expect(page.getByTestId('main')).toBeHidden();

  await page.getByTestId('btn-cards-back').click();

  await expect(page.getByTestId('cards')).toBeHidden();
  await expect(page.getByTestId('main')).toBeVisible();
});

test('offers the screen in every language', async ({ homePage, page }) => {
  for (const [locale, heading] of [
    ['en', 'Credit cards'], ['fr', 'Cartes de crédit'], ['he', 'כרטיסי אשראי'],
  ] as const) {
    await homePage.language.choose(locale);
    await expect(page.getByTestId('cards-h')).toHaveText(heading);
  }
});

/* A household holding two cards from one issuer had them gathered under one heading, at a
   total neither card was ever charged. No export says which Visa is which — the issuer
   names the company, not the card — so the customer is asked, once, at import. */
test.describe('two cards from one issuer', () => {
  const second = () => ({
    name: 'visa-2.csv', mimeType: 'text/csv',
    buffer: Buffer.from(['תאריך העסקה,שם בית העסק,סכום החיוב', '06/09/2026,מוסך הכרמל,900.00'].join('\n')),
  });

  test('lists each named card on its own in the chooser', async ({ homePage, page }) => {
    await homePage.openFresh();
    await homePage.upload.uploadBankReport(statement());
    await homePage.upload.uploadCreditCardReport(visa(), 'external', 'visa', 'הכרטיס של אמא');
    await homePage.upload.uploadCreditCardReport(second(), 'external', 'visa', 'הכרטיס של אבא');
    await homePage.dashboard.openCards();

    await expect(page.getByTestId('f-card').locator('option'))
      .toHaveText(['כל הכרטיסים', 'הכרטיס של אבא', 'הכרטיס של אמא']);
  });

  test('shows only that card when one of them is chosen', async ({ homePage, page }) => {
    await homePage.openFresh();
    await homePage.upload.uploadBankReport(statement());
    await homePage.upload.uploadCreditCardReport(visa(), 'external', 'visa', 'הכרטיס של אמא');
    await homePage.upload.uploadCreditCardReport(second(), 'external', 'visa', 'הכרטיס של אבא');
    await homePage.dashboard.openCards();

    await page.getByTestId('f-card').selectOption({ label: 'הכרטיס של אבא' });

    await expect(homePage.dashboard.cardChargeRows).toHaveCount(1);
    await expect(homePage.dashboard.cardChargeRows.first()).toContainText('מוסך הכרמל');
  });

  /* And the folded line in the transactions table folds the same way. */
  test('folds each card into a line of its own in the transactions table', async ({ homePage }) => {
    await homePage.openFresh();
    await homePage.upload.uploadBankReport(statement());
    await homePage.upload.uploadCreditCardReport(visa(), 'external', 'visa', 'הכרטיס של אמא');
    await homePage.upload.uploadCreditCardReport(second(), 'external', 'visa', 'הכרטיס של אבא');

    await expect(homePage.dashboard.cardGroupRows).toHaveCount(2);
    await expect(homePage.dashboard.cardGroupRows.filter({ hasText: 'הכרטיס של אמא' })).toHaveCount(1);
  });

  /* A card nobody named is known by its issuer, exactly as before. */
  test('leaves a card nobody named known by its issuer', async ({ homePage, page }) => {
    await homePage.openFresh();
    await homePage.upload.uploadBankReport(statement());
    await homePage.upload.uploadCreditCardReport(visa(), 'external', 'visa');
    await homePage.dashboard.openCards();

    await expect(page.getByTestId('f-card').locator('option')).toHaveText(['כל הכרטיסים', 'ויזה']);
  });

  /* The name is free text, and a household that types a card number into it must not have
     it kept — the same rule a merchant description follows. */
  test('does not keep a card number typed into the name', async ({ homePage, page }) => {
    await homePage.openFresh();
    await homePage.upload.uploadCreditCardReport(visa(), 'external', 'visa', 'כרטיס 4580-1234-5678');

    const stored = await page.evaluate(() => window.localStorage.getItem('mazan-habait/v1') ?? '');
    expect(stored).not.toContain('5678');
    expect(stored).toContain('redacted');
  });
});
