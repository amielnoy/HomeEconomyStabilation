import { expect, test } from './fixtures';

/* The data section of the settings drawer is where a household can lose everything: it
   restores a backup over the current session, deletes all of it, and takes transactions the
   customer types themselves. Restoring and rejecting a backup were covered from opposite
   ends — the happy path and the malformed one — but nothing exercised deleting, and nothing
   exercised a manual entry reaching the month it belongs to. */

const bankReport = () => ({
  name: 'bank.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from([
    'תאריך,תיאור פעולה,חובה,זכות,יתרה',
    '02/08/2026,משכורת חודשית,,17400,20000',
    '05/08/2026,ארנונה עיריית חיפה,612,,19388',
  ].join('\n')),
});

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

/* A backup is only worth writing if it can be read back. The file the customer saves is the
   same versioned envelope the browser persists, so taking that envelope, deleting
   everything and feeding it back is the round trip the feature promises — through the real
   codec rather than a shape a test invented. */
test('restores a saved backup after everything was deleted', async ({ homePage, page }) => {
  await homePage.upload.uploadBankReport(bankReport());
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);
  const backup = await page.evaluate(
    () => localStorage.getItem('mazan-habait/v2') ?? localStorage.getItem('mazan-habait/v1') ?? '',
  );
  expect(backup, 'nothing was persisted to back up').not.toBe('');

  await homePage.settings.open();
  await homePage.settings.openDataSection();
  await page.getByTestId('dr-wipe').click();
  await page.getByTestId('dr-wipe').click();
  await expect(homePage.emptyState).toBeVisible();

  await homePage.settings.open();
  await homePage.settings.openDataSection();
  await homePage.settings.backupInput.setInputFiles({
    name: 'mazan-habait-2026-08-30.json', mimeType: 'application/json', buffer: Buffer.from(backup),
  });

  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);
  await expect(homePage.dashboard.transactionRows.filter({ hasText: 'ארנונה עיריית חיפה' })).toHaveCount(1);
});

/* The export itself: no browser download API here, so the JSON goes to the clipboard. */
test('copies the backup out when no download API is available', async ({ homePage, page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Clipboard permissions are grantable on Chromium only');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await homePage.upload.uploadBankReport(bankReport());

  /* A header control, not a drawer one — opening the drawer would make it inert. On a phone
     it lives behind the overflow toggle, exactly as the settings control does. */
  const backup = page.getByTestId('btn-backup');
  if (!await backup.isVisible()) await page.getByTestId('mobile-menu-toggle').click();
  await backup.click();

  await expect(homePage.toast).toContainText('הועתק');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const parsed = JSON.parse(copied) as { app: string; tx: Array<{ desc: string; ref: string; src: string }> };
  expect(parsed.app).toBe('mazan-habait');
  expect(parsed.tx).toHaveLength(2);
  // The exported copy is the minimised one: no references, no original filename.
  expect(parsed.tx.every((row) => row.ref === '')).toBe(true);
  expect(parsed.tx.every((row) => row.src === 'bank-report')).toBe(true);
});

/* Deleting a household's whole financial history on one stray click would be unrecoverable,
   so the control arms itself first and says so. */
test('asks a second time before deleting everything', async ({ homePage, page }) => {
  await homePage.upload.uploadBankReport(bankReport());
  await homePage.settings.open();
  await homePage.settings.openDataSection();

  await page.getByTestId('dr-wipe').click();

  await expect(page.getByTestId('dr-wipe')).not.toHaveText('מחיקת הכל');
  // Armed only — the first click must not have taken anything.
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);
});

test('deletes every transaction once the second click confirms it', async ({ homePage, page }) => {
  await homePage.upload.uploadBankReport(bankReport());
  await homePage.settings.open();
  await homePage.settings.openDataSection();

  await page.getByTestId('dr-wipe').click();
  await page.getByTestId('dr-wipe').click();

  await expect(homePage.toast).toContainText('נמחקו');
  await expect(homePage.emptyState).toBeVisible();
  // Gone from storage too, not just from the screen.
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('mazan-habait/v2') ?? localStorage.getItem('mazan-habait/v1') ?? '{}';
    return ((JSON.parse(raw).tx ?? []) as unknown[]).length;
  });
  expect(stored).toBe(0);
});

test('says there is nothing to delete rather than arming on an empty session', async ({ homePage, page }) => {
  await homePage.settings.open();
  await homePage.settings.openDataSection();

  await page.getByTestId('dr-wipe').click();

  await expect(homePage.toast).toContainText('אין מה למחוק');
  await expect(page.getByTestId('dr-wipe')).toHaveText('מחיקת הכל');
});

/* Cash spending never appears in any export, so a household that only imports reports has
   an incomplete month until it can type one in. */
test('adds a typed transaction to the month it belongs to', async ({ homePage, page }) => {
  await homePage.upload.uploadBankReport(bankReport());
  await expect(homePage.dashboard.transactionRows).toHaveCount(2);
  await homePage.settings.open();
  await page.getByTestId('settings-section-manual').locator('summary').click();

  await page.getByTestId('manual-date').fill('2026-08-14');
  await page.getByTestId('manual-desc').fill('שוק מחנה יהודה');
  await page.getByTestId('manual-amount').fill('120');
  await page.getByTestId('manual-dir').selectOption('out');
  await page.getByTestId('manual-cat').selectOption('food');
  await page.getByTestId('manual-submit').click();

  await expect(homePage.dashboard.transactionRows).toHaveCount(3);
  const typed = homePage.dashboard.transactionRows.filter({ hasText: 'שוק מחנה יהודה' });
  await expect(typed).toHaveCount(1);
  // The category chosen while typing is the category it keeps.
  await expect(typed.getByTestId('transaction-category-select')).toHaveValue('food');
});
