import { HttpStatus } from '../../src/http-status';
import { expect, test } from './fixtures';

test('keeps profile and consent metadata closed to anonymous callers', async ({ homeEconomyApi }) => {
  for (const response of [
    await homeEconomyApi.getProfileWithoutAuthentication(),
    await homeEconomyApi.getCloudConsentWithoutAuthentication(),
  ]) {
    const body = await response.json();
    expect([HttpStatus.UNAUTHORIZED, HttpStatus.SERVICE_UNAVAILABLE]).toContain(response.status());
    expect(['authentication_required', 'cloud_not_configured']).toContain(body.code);
    expect(body).not.toHaveProperty('profile');
    expect(body).not.toHaveProperty('consent');
    expect(response.headers()['cache-control']).toBe('no-store');
  }
});

test('rejects malformed metadata before authentication or provider work', async ({ homeEconomyApi }) => {
  const invalidProfile = await homeEconomyApi.putInvalidProfile();
  expect(invalidProfile.status()).toBe(HttpStatus.BAD_REQUEST);
  await expect(invalidProfile.json()).resolves.toEqual({ code: 'invalid_request' });

  const textConsent = await homeEconomyApi.putConsentAsText();
  expect(textConsent.status()).toBe(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
  await expect(textConsent.json()).resolves.toEqual({ code: 'json_content_type_required' });
});

test('rejects unsupported consent methods with a stable contract', async ({ homeEconomyApi }) => {
  const response = await homeEconomyApi.postCloudConsent();
  expect(response.status()).toBe(HttpStatus.METHOD_NOT_ALLOWED);
  expect(response.headers().allow).toBe('GET, PUT, DELETE');
  await expect(response.json()).resolves.toEqual({ code: 'method_not_allowed' });
});
