import { expect, test } from './fixtures';

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
});

test('renders workbook-controlled merchant text as text, never executable markup', async ({ homePage }) => {
  const payload = '<svg/onload=x=1>x';
  await homePage.page.evaluate(() => { (window as Window & { x?: number }).x = 0; });
  await homePage.upload.uploadBankReport({
    name: 'security-sanity.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      'תאריך,תיאור פעולה,חובה,יתרה',
      `23/06/2026,"${payload}",100,1100`,
      `23/07/2026,"${payload}",100,1000`,
    ].join('\n')),
  });
  await expect(homePage.dashboard.root).toBeVisible();

  const foundPayload = await homePage.dashboard.findForecastTooltipText(payload);

  expect(foundPayload).toBe(true);
  await expect(homePage.dashboard.forecastTooltip).toContainText(payload);
  await expect(homePage.dashboard.forecastTooltip.locator('svg, img')).toHaveCount(0);
  expect(await homePage.page.evaluate(() => (window as Window & { x?: number }).x)).toBe(0);
});

test('rejects malformed backup data without replacing the current session', async ({ homePage }) => {
  await homePage.settings.open();
  await homePage.settings.importBackup({
    name: 'not-a-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"tx":"not-an-array"}'),
  });

  await expect(homePage.toast).toContainText('אינו גיבוי תקין');
  await expect(homePage.emptyState).toBeVisible();
});

test('external directory links preserve opener isolation', async ({ homePage }) => {
  await homePage.savingsDirectory.open();
  const links = homePage.savingsDirectory.externalLinks;
  expect(await links.count()).toBeGreaterThan(0);
  for (let index = 0; index < await links.count(); index += 1) {
    await expect(links.nth(index)).toHaveAttribute('rel', /noopener.*noreferrer/);
    await expect(links.nth(index)).toHaveAttribute('href', /^https:\/\//);
  }
});

test('keeps imported financial data on the device without outgoing write requests', async ({ homePage }) => {
  const outgoingWrites: Array<{ method: string; url: string }> = [];
  homePage.page.on('request', (request) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
      outgoingWrites.push({ method: request.method(), url: request.url() });
    }
  });

  await homePage.upload.uploadSampleBankReport();
  await expect(homePage.dashboard.root).toBeVisible();
  await expect(homePage.dashboard.accountSummary).toContainText('04-279-661711');
  expect(outgoingWrites).toEqual([]);
});
