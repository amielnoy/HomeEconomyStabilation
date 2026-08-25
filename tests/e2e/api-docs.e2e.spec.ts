import { expect, test } from './fixtures';

test('loads the self-hosted Swagger explorer with every API operation', async ({ apiDocsPage }) => {
  const specResponse = apiDocsPage.page.waitForResponse((response) => response.url().endsWith('/openapi.json'));
  await apiDocsPage.open();

  await expect((await specResponse).status()).toBe(200);
  await expect(apiDocsPage.root).toBeVisible();
  await expect(apiDocsPage.scalarLink).toHaveAttribute('href', '/scalar-docs.html');
  await expect(apiDocsPage.authorizeButton).toBeVisible();
  await expect(apiDocsPage.healthOperation).toBeVisible();
  await expect(apiDocsPage.loadOperation).toBeVisible();
  await expect(apiDocsPage.saveOperation).toBeVisible();
  await expect(apiDocsPage.deleteOperation).toBeVisible();
  await expect(apiDocsPage.loadProfileOperation).toBeVisible();
  await expect(apiDocsPage.saveProfileOperation).toBeVisible();
  await expect(apiDocsPage.loadConsentOperation).toBeVisible();
  await expect(apiDocsPage.acceptConsentOperation).toBeVisible();
  await expect(apiDocsPage.withdrawConsentOperation).toBeVisible();
});

test('loads the self-hosted Scalar explorer from the shared OpenAPI contract', async ({ scalarDocsPage }) => {
  const requestedUrls: string[] = [];
  scalarDocsPage.page.on('request', (request) => requestedUrls.push(request.url()));
  const specResponse = scalarDocsPage.page.waitForResponse((response) => response.url().endsWith('/openapi.json'));
  await scalarDocsPage.open();

  await expect((await specResponse).status()).toBe(200);
  await expect(scalarDocsPage.root).toBeVisible();
  await expect(scalarDocsPage.reference).toBeVisible();
  await expect(scalarDocsPage.swaggerLink).toHaveAttribute('href', '/api-docs.html');
  await expect(scalarDocsPage.healthOperation).toBeVisible();
  await expect(scalarDocsPage.testHealthRequestButton).toBeVisible();
  await expect(scalarDocsPage.loadOperation).toBeVisible();
  await expect(scalarDocsPage.saveOperation).toBeVisible();
  await expect(scalarDocsPage.deleteOperation).toBeVisible();
  await expect(scalarDocsPage.loadProfileOperation).toBeVisible();
  await expect(scalarDocsPage.saveProfileOperation).toBeVisible();
  await scalarDocsPage.openConsentGroupButton.click();
  await expect(scalarDocsPage.loadConsentOperation).toBeVisible();
  await expect(scalarDocsPage.acceptConsentOperation).toBeVisible();
  await expect(scalarDocsPage.withdrawConsentOperation).toBeVisible();

  const pageOrigin = new URL(scalarDocsPage.page.url()).origin;
  expect(requestedUrls.filter((url) => url.startsWith('http') && new URL(url).origin !== pageOrigin)).toEqual([]);
});
