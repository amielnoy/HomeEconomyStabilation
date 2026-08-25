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

  it('provisions a privacy-safe Supabase dashboard without database credentials', () => {
    const dashboard = JSON.parse(read('monitoring/grafana/dashboards/home-economy-database.json'));
    const metrics = read('server/metrics.py');
    const compose = read('docker-compose.yml');

    expect(dashboard.uid).toBe('home-economy-database');
    expect(dashboard.panels.map((panel: { title: string }) => panel.title)).toEqual([
      'Supabase availability', 'Supabase health latency',
      'Supabase error rate', 'Snapshot writes blocked by consent · 1h',
      'Cloud API responses by route and status', 'Supabase operations by status',
      'Supabase activity by data domain', 'Latest Supabase operation latency',
    ]);
    const dashboardJson = JSON.stringify(dashboard);
    for (const value of ['profile_.*', 'consent_.*', 'snapshot_.*', 'auth_verify', 'route']) {
      expect(dashboardJson).toContain(value);
    }
    expect(metrics).toContain('home_economy_supabase_up');
    expect(metrics).toContain('home_economy_supabase_requests_total');
    expect(metrics).toContain('route="{route}"');
    expect(metrics).toContain('"cloud_consent"');
    expect(metrics).not.toContain('user_id');
    expect(compose).not.toContain('SUPABASE_DB_PASSWORD');
    expect(compose).not.toContain('DATABASE_URL');
  });

  it('scrapes internal metrics that probe the application, Swagger, Scalar and API', () => {
    const prometheus = read('monitoring/prometheus.yml');
    const server = read('server/metrics.py');

    expect(prometheus).toContain('targets: ["api:3000"]');
    expect(prometheus).toContain('metrics_path: /metrics');
    expect(server).toContain('_probe("application"');
    expect(server).toContain('_probe("swagger"');
    expect(server).toContain('_probe("scalar"');
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
    expect(runner).toContain('compose down --remove-orphans');
    expect(runner).toContain('compose up --detach --force-recreate --wait allure');
    expect(containerRunner).toContain('VITEST_SCRIPT=test:allure SERVER_TEST_SCRIPT=test:server:allure sh scripts/run-tests-in-parallel.sh');
    expect(containerRunner).toContain('npx allure generate');
  });

  it('runs Scalar as a health-checked Docker Compose service', () => {
    const compose = read('docker-compose.yml');
    const manualCompose = read('docker-compose.manual.yml');
    const dockerignore = read('.dockerignore');

    expect(compose).toContain('scalar:');
    expect(compose).toContain('dockerfile: Dockerfile.scalar');
    expect(compose).toContain('PLAYWRIGHT_SCALAR_BASE_URL: "http://scalar"');
    expect(compose).toContain('MONITOR_SCALAR_ORIGIN: "http://scalar"');
    expect(manualCompose).toContain('${SCALAR_PORT:-8767}:80');
    expect(dockerignore.split(/\r?\n/)).not.toContain('.github');
  });

  it('runs Vitest, Pytest and Playwright concurrently in local, CI and Docker release gates', () => {
    const packageJson = JSON.parse(read('package.json'));
    const parallelRunner = read('scripts/run-tests-in-parallel.sh');
    const containerRunner = read('scripts/run-tests-and-generate-allure.sh');
    const workflow = read('.github/workflows/ci.yml');
    const playwrightConfig = read('playwright.config.ts');

    expect(packageJson.scripts['test:all']).toBe('sh scripts/run-tests-in-parallel.sh');
    expect(parallelRunner).toContain('npm run "$VITEST_SCRIPT" &');
    expect(parallelRunner).toContain('npm run "$SERVER_TEST_SCRIPT" &');
    expect(parallelRunner).toContain('npm run test:e2e &');
    expect(parallelRunner).toContain('wait "$vitest_pid"');
    expect(parallelRunner).toContain('wait "$server_pid"');
    expect(parallelRunner).toContain('wait "$playwright_pid"');
    expect(parallelRunner).toContain('vitest=$vitest_status pytest=$server_status playwright=$playwright_status');
    expect(containerRunner).toContain('SERVER_TEST_SCRIPT=test:server:allure');
    expect(workflow).toContain('Run Vitest, Pytest and Playwright in parallel');
    expect(workflow).toContain('run: npm run test:all');
    expect(workflow).toContain('actions/upload-artifact@v6');
    expect(workflow).not.toContain('actions/upload-artifact@v5');
    expect(playwrightConfig).toContain('workers: process.env.CI ? 2 : undefined');
  });
});
