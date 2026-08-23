import { createServer } from 'node:http';
import healthHandler from '../dist-api/api/health.js';
import snapshotHandler from '../dist-api/api/snapshots.js';
import { HttpStatus } from '../dist-api/src/http-status.js';

const port = Number(process.env.PORT || 3000);
const maxBodyBytes = 1_050_000;
const webOrigin = process.env.MONITOR_WEB_ORIGIN || 'http://web';
const requestCounts = new Map();

async function probe(name, url) {
  const startedAt = performance.now();
  try {
    const result = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return { name, up: result.ok ? 1 : 0, duration: (performance.now() - startedAt) / 1_000 };
  } catch {
    return { name, up: 0, duration: (performance.now() - startedAt) / 1_000 };
  }
}

async function metrics() {
  const probes = await Promise.all([
    probe('application', `${webOrigin}/mazan-habait.html`),
    probe('swagger', `${webOrigin}/api-docs.html`),
  ]);
  const lines = [
    '# HELP home_economy_process_uptime_seconds API process uptime.',
    '# TYPE home_economy_process_uptime_seconds gauge',
    `home_economy_process_uptime_seconds ${process.uptime()}`,
    '# HELP home_economy_endpoint_up Whether a monitored endpoint returned a successful response.',
    '# TYPE home_economy_endpoint_up gauge',
    'home_economy_endpoint_up{endpoint="api"} 1',
    '# HELP home_economy_endpoint_duration_seconds Duration of the latest endpoint probe.',
    '# TYPE home_economy_endpoint_duration_seconds gauge',
  ];
  for (const result of probes) {
    lines.push(`home_economy_endpoint_up{endpoint="${result.name}"} ${result.up}`);
    lines.push(`home_economy_endpoint_duration_seconds{endpoint="${result.name}"} ${result.duration}`);
  }
  lines.push(
    '# HELP home_economy_http_requests_total HTTP responses served by method and status.',
    '# TYPE home_economy_http_requests_total counter',
  );
  for (const [key, count] of requestCounts) {
    const [method, status] = key.split(':');
    lines.push(`home_economy_http_requests_total{method="${method}",status="${status}"} ${count}`);
  }
  return `${lines.join('\n')}\n`;
}

function createResponseAdapter(response) {
  let statusCode = HttpStatus.OK;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader(name, value) {
      response.setHeader(name, value);
    },
    json(body) {
      response.statusCode = statusCode;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(body));
    },
    end() {
      response.statusCode = statusCode;
      response.end();
    },
  };
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error('payload_too_large');
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined;
}

const server = createServer(async (request, response) => {
  response.once('finish', () => {
    const key = `${request.method || 'UNKNOWN'}:${response.statusCode}`;
    requestCounts.set(key, (requestCounts.get(key) || 0) + 1);
  });
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/health') {
    response.statusCode = HttpStatus.OK;
    response.end('ok');
    return;
  }
  if (request.url === '/api/health') {
    healthHandler({ method: request.method }, createResponseAdapter(response));
    return;
  }
  if (request.url === '/metrics') {
    response.statusCode = HttpStatus.OK;
    response.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    response.end(await metrics());
    return;
  }
  if (request.url !== '/api/snapshots') {
    response.statusCode = HttpStatus.NOT_FOUND;
    response.end();
    return;
  }

  try {
    await snapshotHandler({
      method: request.method,
      headers: request.headers,
      body: await readBody(request),
    }, createResponseAdapter(response));
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'payload_too_large';
    response.statusCode = tooLarge ? HttpStatus.CONTENT_TOO_LARGE : HttpStatus.INTERNAL_SERVER_ERROR;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ code: tooLarge ? 'payload_too_large' : 'internal_error' }));
  }
});

server.listen(port, '0.0.0.0');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
