import { expect, test } from './fixtures';

test('loads the self-hosted Swagger explorer with every API operation', async ({ apiDocsPage }) => {
  const specResponse = apiDocsPage.page.waitForResponse((response) => response.url().endsWith('/openapi.json'));
  await apiDocsPage.open();

  await expect((await specResponse).status()).toBe(200);
  await expect(apiDocsPage.root).toBeVisible();
  await expect(apiDocsPage.authorizeButton).toBeVisible();
  await expect(apiDocsPage.healthOperation).toBeVisible();
  await expect(apiDocsPage.loadOperation).toBeVisible();
  await expect(apiDocsPage.saveOperation).toBeVisible();
  await expect(apiDocsPage.deleteOperation).toBeVisible();
});
