import { expect, test } from './fixtures';

/* The parts of the HTTP surface nothing reached yet: the two operational endpoints the
   container and Prometheus depend on, and the request guard that stands in front of every
   snapshot write. The guard is the only thing between an unauthenticated caller and the
   work of parsing a megabyte of JSON, so each of its refusals is a contract worth pinning —
   including that it refuses *before* doing that work. */

test.describe('operational endpoints', () => {
  /* The container orchestrator restarts the service on this, so it must answer plainly and
     never require a credential. */
  test('answers the container health probe without authentication', async ({ request }) => {
    const response = await request.get('/health');

    expect(response.status()).toBe(200);
    expect((await response.text()).trim()).toBe('ok');
  });

  /* Prometheus parses this text format strictly; a stray body would drop every metric. */
  test('publishes Prometheus metrics in the exposition format', async ({ request }) => {
    const response = await request.get('/metrics');

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/plain');
    const body = await response.text();
    expect(body).toContain('home_economy_endpoint_up');
    // Every reported series carries a HELP and TYPE line before its samples.
    const declared = new Set([...body.matchAll(/^# TYPE (\w+)/gm)].map((match) => match[1]!));
    for (const metric of declared) {
      expect(body, `${metric} has no HELP line`).toContain(`# HELP ${metric}`);
    }
  });

  /* Route labels are bounded on purpose: an unbounded label lets a crafted URL create a new
     time series on every request until the scrape falls over. */
  test('keeps metric labels bounded when an unknown route is called', async ({ request }) => {
    await request.get('/api/does-not-exist-12345');

    const body = await (await request.get('/metrics')).text();
    expect(body).not.toContain('does-not-exist-12345');
    expect(body).toContain('other');
  });

  test('does not let the metrics endpoint be written to', async ({ request }) => {
    const response = await request.post('/metrics');

    expect(response.status()).toBe(405);
  });
});

test.describe('snapshot request guard', () => {
  /* Parsing is the expensive part, so the size is refused before the body is read — an
     unauthenticated caller cannot make the API do that work. The limit is 1,010,000 bytes. */
  test('refuses a snapshot larger than the limit', async ({ request }) => {
    const oversized = `{"tx":[${'0,'.repeat(600_000)}0]}`;
    expect(oversized.length).toBeGreaterThan(1_010_000);

    const response = await request.put('/api/snapshots', {
      headers: { 'Content-Type': 'application/json' }, data: oversized,
    });

    expect(response.status()).toBe(413);
    expect(await response.json()).toEqual({ code: 'snapshot_too_large' });
  });

  test('refuses a snapshot write that is not JSON', async ({ request }) => {
    const response = await request.put('/api/snapshots', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'tx=1',
    });

    expect(response.status()).toBe(415);
    expect(await response.json()).toEqual({ code: 'json_content_type_required' });
  });

  /* Order matters: the format refusal must come before the authentication refusal, or an
     anonymous caller learns whether a token would have been accepted. */
  test('refuses on content type before it considers the caller', async ({ request }) => {
    const response = await request.put('/api/snapshots', {
      headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer obviously-not-a-token' },
      data: 'not-json',
    });

    expect(response.status()).toBe(415);
  });

  /* Which refusal a malformed token earns depends on the deployment — an unconfigured one
     never gets as far as verifying it. What must hold everywhere is that it is never
     accepted, and that the answer says nothing about why beyond a code. */
  test('never accepts a malformed bearer token', async ({ request }) => {
    const response = await request.get('/api/snapshots', {
      headers: { Authorization: 'Bearer not.a.jwt' },
    });

    expect(response.ok()).toBe(false);
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(Object.keys(await response.json())).toEqual(['code']);
  });
});

test.describe('response contract', () => {
  /* A cached financial response on a shared machine is the whole privacy promise undone. */
  test('marks every API response no-store', async ({ request }) => {
    for (const path of ['/api/health', '/api/snapshots', '/api/profile', '/api/does-not-exist']) {
      const response = await request.get(path);
      expect(response.headers()['cache-control'], `${path} is cacheable`).toBe('no-store');
    }
  });

  /* One failure shape across every refusal the application constructs itself: a bare code,
     never a message quoting back what the caller sent. A route the application never
     declared is answered by the framework instead, and that response is covered separately
     by the not-found test, which asserts it stays small and names nothing internal. */
  test('answers every refusal it owns with a bare code and nothing else', async ({ request }) => {
    const refusals = await Promise.all([
      request.get('/api/snapshots'),
      request.post('/api/health'),
      request.get('/api/profile'),
      request.put('/api/snapshots', { headers: { 'Content-Type': 'text/plain' }, data: 'x' }),
    ]);

    for (const response of refusals) {
      expect(response.status()).toBeGreaterThanOrEqual(400);
      const body = await response.json();
      expect(Object.keys(body), `${response.url()} returned more than a code`).toEqual(['code']);
      expect(typeof body.code).toBe('string');
    }
  });
});
