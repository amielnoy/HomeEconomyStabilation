import { expect, test } from './fixtures';
import { issuerCardReport } from './reports';

/* The log exists to answer "what happened on that customer's machine" from a file they
   send. Two things have to hold for that to be worth anything: it has to record the import
   it was built for, and it has to be safe to send. Both are properties of the running
   application rather than of the logger class, so they are checked here. */

const logText = (page: import('@playwright/test').Page) => page.evaluate(
  () => (window as unknown as { __log: { toText(): string } }).__log.toText(),
);

const logRecords = async (page: import('@playwright/test').Page) => (await logText(page))
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as { event: string; level: string; source: string; context?: Record<string, unknown> });

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('records the whole import path from one uploaded report', async ({ homePage, page }) => {
  await homePage.upload.uploadCreditCardReport(issuerCardReport());
  await expect(homePage.dashboard.root).toBeVisible();

  const events = (await logRecords(page)).map((record) => record.event);

  expect(events).toContain('report.import.started');
  expect(events).toContain('report.read');
  expect(events).toContain('report.import.completed');
});

/* The container a file turned out to be is the first thing worth knowing when an import
   produces nothing, and the hardest thing to establish afterwards without it. */
test('names the detected format and the shape of what was read', async ({ homePage, page }) => {
  await homePage.upload.uploadCreditCardReport(issuerCardReport());

  const read = (await logRecords(page)).find((record) => record.event === 'report.read')!;

  expect(read.context).toMatchObject({ source: 'card', format: 'csv', sheets: 1 });
  expect(read.context!.rows).toBeGreaterThan(0);
});

test('records why an unrecognised report was rejected', async ({ homePage, page }) => {
  await homePage.upload.creditCardInput.setInputFiles({
    name: 'mystery.csv', mimeType: 'text/csv', buffer: Buffer.from('עמודה א,עמודה ב\n1,2'),
  });
  await expect(homePage.toast).toContainText('mystery.csv');

  const rejected = (await logRecords(page)).find((record) => record.event === 'report.import.rejected')!;

  expect(rejected.level).toBe('warn');
  expect(rejected.context).toMatchObject({ reason: 'columns-unrecognised' });
});

/* One delegated listener stands in for a log call in every handler, so the thing to prove
   is that pressing a control actually reaches it. */
test('records every command the customer runs', async ({ homePage, page }) => {
  await homePage.upload.uploadCreditCardReport(issuerCardReport());
  await homePage.dashboard.openRecommendations();

  const commands = (await logRecords(page))
    .filter((record) => record.event === 'ui.command')
    .map((record) => record.context!.control);

  expect(commands).toContain('btn-recommendations');
});

/* The log is a file the customer is asked to send, which makes it a second copy of
   whatever it records. The statement's contents must not be in it. */
test('keeps the statement out of the log it asks the customer to send', async ({ homePage, page }) => {
  await homePage.upload.uploadCreditCardReport(issuerCardReport());
  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.transactionRows).toHaveCount(4);

  const text = await logText(page);

  // Merchants are in the report and rendered on the dashboard, never logged.
  for (const value of ['שופרסל דיל', 'נטפליקס', 'AMAZON US']) {
    expect(text, `the log leaks "${value}"`).not.toContain(value);
  }
  // Customers name statements after the account they came from.
  expect(text).not.toContain('card-statement.csv');

  /* Amounts cannot be grepped for as bare numbers: the log legitimately carries byte and
     row counts, so a fixture whose size happened to contain those digits would read as a
     leak. The durable property is that the context keys are a bounded set — a future field
     carrying a description or an amount fails here rather than shipping quietly. */
  const keys = new Set((await logRecords(page)).flatMap((record) => Object.keys(record.context ?? {})));
  const allowed = new Set([
    'source', 'files', 'cardKind', 'format', 'bytes', 'sheets', 'rows',
    'added', 'duplicates', 'failed', 'reason', 'columns', 'error', 'control', 'via',
  ]);
  expect([...keys].filter((key) => !allowed.has(key)), 'an unapproved field reached the log').toEqual([]);
});

test('holds a bounded number of records however long the tab stays open', async ({ homePage, page }) => {
  const count = await page.evaluate(() => {
    const logger = (window as unknown as { __log: { info(event: string): void; entries(): unknown[] } }).__log;
    for (let index = 0; index < 2000; index += 1) logger.info('ui.command');
    return logger.entries().length;
  });

  expect(count).toBeLessThanOrEqual(500);
});

/* Support cannot ask a customer to rebuild the application, so the level has to be
   reachable from the address bar. */
test('raises the level from the query string', async ({ homePage, page }) => {
  await homePage.open('?log=debug');

  expect(await page.evaluate(
    () => (window as unknown as { __log: { getLevel(): string } }).__log.getLevel(),
  )).toBe('debug');
});

/* The browser's daily backup: a copy under today's key, so a problem reported the next
   morning still has the records that describe it. */
test('keeps a dated copy of the log that survives a reload', async ({ homePage, page }) => {
  await homePage.upload.uploadCreditCardReport(issuerCardReport());
  await expect(homePage.dashboard.root).toBeVisible();

  await page.evaluate(() => (window as unknown as { __log: { flush(): void } }).__log.flush());
  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.startsWith('mazan-habait.log.'));
    return key ? { key, value: localStorage.getItem(key)! } : null;
  });

  expect(stored, 'no dated copy was written').not.toBeNull();
  expect(stored!.key).toMatch(/^mazan-habait\.log\.\d{4}-\d{2}-\d{2}$/);
  expect(stored!.value).toContain('report.import.completed');

  await homePage.reload();
  const archive = await page.evaluate(
    () => (window as unknown as { __log: { archive(): string } }).__log.archive(),
  );
  expect(archive, 'the copy did not survive the reload').toContain('report.import.completed');
});

/* The dated copies share storage with the customer's transactions, so what they must never
   contain is the same thing the in-memory log must never contain. */
test('keeps the statement out of the dated copy as well', async ({ homePage, page }) => {
  await homePage.upload.uploadCreditCardReport(issuerCardReport());
  await page.evaluate(() => (window as unknown as { __log: { flush(): void } }).__log.flush());

  const stored = await page.evaluate(() => Object.keys(localStorage)
    .filter((name) => name.startsWith('mazan-habait.log.'))
    .map((name) => localStorage.getItem(name) ?? '')
    .join('\n'));

  for (const value of ['שופרסל דיל', 'AMAZON US', '148.2', 'card-statement.csv']) {
    expect(stored, `the dated copy leaks "${value}"`).not.toContain(value);
  }
});
