import { expect, test } from './fixtures';

test.beforeEach(async ({ homePage }) => {
  await homePage.openFresh();
  await homePage.settings.open();
});

test('records and withdraws explicit cloud consent without uploading financial data', async ({ homePage }) => {
  const writes: string[] = [];
  homePage.page.on('request', (request) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url());
  });

  await expect(homePage.settings.cloudConsent).toBeVisible();
  await expect(homePage.settings.cloudConsentCheck).not.toBeChecked();
  await expect(homePage.settings.cloudConsentAccept).toBeDisabled();
  await homePage.settings.acceptCloudConsent();
  await expect(homePage.settings.cloudConsentStatus).toContainText('תועדה במכשיר');
  await expect(homePage.settings.cloudConsentWithdraw).toBeVisible();
  expect(writes).toEqual([]);

  await homePage.settings.withdrawCloudConsent();
  await expect(homePage.settings.cloudConsentStatus).toContainText('לא ניתנה הסכמה');
});
