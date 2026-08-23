import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

describe('monitoring contract', () => {
  it('wires Grafana to a provisioned Prometheus datasource and dashboard', () => {
    const compose = read('docker-compose.yml');
    const datasource = read('monitoring/grafana/provisioning/datasources/prometheus.yml');
    const dashboard = JSON.parse(read('monitoring/grafana/dashboards/home-economy-health.json'));

    expect(compose).toContain('grafana/grafana:13.1.0');
    expect(compose).toContain('prom/prometheus:v3.12.0');
    expect(datasource).toContain('url: http://prometheus:9090');
    expect(dashboard.uid).toBe('home-economy-health');
    expect(dashboard.panels.map((panel: { title: string }) => panel.title)).toEqual([
      'Service health', 'Endpoint response time', 'API uptime', 'API responses by status',
    ]);
  });

  it('scrapes internal metrics that probe the application, Swagger and API', () => {
    const prometheus = read('monitoring/prometheus.yml');
    const server = read('scripts/api-server.mjs');

    expect(prometheus).toContain('targets: ["api:3000"]');
    expect(prometheus).toContain('metrics_path: /metrics');
    expect(server).toContain("probe('application'");
    expect(server).toContain("probe('swagger'");
    expect(server).toContain('endpoint="api"');
    expect(server).toContain('home_economy_endpoint_up');
    expect(server).toContain('home_economy_http_requests_total');
  });

  it('publishes a combined Allure report after the Docker test run', () => {
    const compose = read('docker-compose.yml');
    const runner = read('scripts/run-all-tests.sh');
    const containerRunner = read('scripts/run-tests-and-generate-allure.sh');

    expect(compose).toContain('allure-report:/usr/share/nginx/html:ro');
    expect(compose).toContain('allure-results:/workspace/allure-results');
    expect(runner).toContain('http://127.0.0.1:$ALLURE_PORT');
    expect(runner).toContain('Published on Vercel');
    expect(runner).toContain('$PRODUCTION_URL/api/health');
    expect(runner).toContain('Local Docker services (available on this computer only)');
    expect(runner).toContain('npm run test:docker:stop');
    expect(containerRunner).toContain('VITEST_SCRIPT=test:allure sh scripts/run-tests-in-parallel.sh');
    expect(containerRunner).toContain('npx allure generate');
  });

  it('runs Vitest and Playwright concurrently in local, CI and Docker release gates', () => {
    const packageJson = JSON.parse(read('package.json'));
    const parallelRunner = read('scripts/run-tests-in-parallel.sh');
    const containerRunner = read('scripts/run-tests-and-generate-allure.sh');
    const workflow = read('.github/workflows/ci.yml');
    const playwrightConfig = read('playwright.config.ts');

    expect(packageJson.scripts['test:all']).toBe('sh scripts/run-tests-in-parallel.sh');
    expect(parallelRunner).toContain('npm run "$VITEST_SCRIPT" &');
    expect(parallelRunner).toContain('npm run test:e2e &');
    expect(parallelRunner).toContain('wait "$vitest_pid"');
    expect(parallelRunner).toContain('wait "$playwright_pid"');
    expect(parallelRunner).toContain('vitest=$vitest_status playwright=$playwright_status');
    expect(containerRunner).toContain('VITEST_SCRIPT=test:allure sh scripts/run-tests-in-parallel.sh');
    expect(workflow).toContain('Run Vitest and Playwright in parallel');
    expect(workflow).toContain('run: npm run test:all');
    expect(playwrightConfig).toContain('workers: process.env.CI ? 2 : undefined');
  });
});
