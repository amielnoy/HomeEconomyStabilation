import { HttpStatus } from '../../src/http-status';
import { expect, test } from './fixtures';

test('reports API health over a real HTTP connection', async ({ homeEconomyApi }) => {
  const response = await homeEconomyApi.getHealth();

  expect(response.status()).toBe(HttpStatus.OK);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(response.headers()['content-type']).toContain('application/json');
  await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'home-economy-api' });
});

test('supports HEAD and rejects unsupported health methods', async ({ homeEconomyApi }) => {
  const headResponse = await homeEconomyApi.headHealth();
  const postResponse = await homeEconomyApi.postHealth();

  expect(headResponse.status()).toBe(HttpStatus.OK);
  expect(await headResponse.body()).toHaveLength(0);
  expect(postResponse.status()).toBe(HttpStatus.METHOD_NOT_ALLOWED);
  expect(postResponse.headers().allow).toBe('GET, HEAD');
  await expect(postResponse.json()).resolves.toEqual({ code: 'method_not_allowed' });
});

test('keeps cloud snapshots closed to anonymous callers', async ({ homeEconomyApi }) => {
  const response = await homeEconomyApi.getSnapshotWithoutAuthentication();
  const body = await response.json();

  expect([HttpStatus.UNAUTHORIZED, HttpStatus.SERVICE_UNAVAILABLE]).toContain(response.status());
  expect(['authentication_required', 'cloud_not_configured']).toContain(body.code);
  expect(body).not.toHaveProperty('snapshot');
});

test('rejects unsupported snapshot methods before processing data', async ({ homeEconomyApi }) => {
  const response = await homeEconomyApi.postSnapshot();

  expect(response.status()).toBe(HttpStatus.METHOD_NOT_ALLOWED);
  expect(response.headers().allow).toBe('GET, PUT, DELETE');
  await expect(response.json()).resolves.toEqual({ code: 'method_not_allowed' });
});

test('returns a stable not-found response for unknown API routes', async ({ homeEconomyApi }) => {
  const response = await homeEconomyApi.getMissingRoute();

  expect(response.status()).toBe(HttpStatus.NOT_FOUND);
  expect(await response.body()).toHaveLength(0);
});
