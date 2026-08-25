import { defineConfig, devices } from '@playwright/test';

const webBaseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8765';
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL || process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8766';
const webServers = process.env.PLAYWRIGHT_BASE_URL ? undefined : [
  {
    command: 'python3 -m http.server 8765',
    url: 'http://127.0.0.1:8765/mazan-habait.html',
    reuseExistingServer: true,
    stdout: 'ignore' as const,
    stderr: 'ignore' as const,
  },
  {
    command: 'npm run build:api && python3 -m uvicorn server.app:app --host 127.0.0.1 --port 8766',
    url: 'http://127.0.0.1:8766/api/health',
    reuseExistingServer: true,
    stdout: 'ignore' as const,
    stderr: 'ignore' as const,
  },
];

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.ALLURE_RESULTS_DIR ? [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['allure-playwright', {
      resultsDir: process.env.ALLURE_RESULTS_DIR,
      detail: true,
      suiteTitle: true,
      environmentInfo: {
        execution: 'Docker Compose',
        browser_matrix: 'Desktop Chrome, Android Chrome, iOS WebKit',
      },
    }],
  ] : [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: webBaseURL,
    trace: 'retain-on-failure',
  },
  webServer: webServers,
  projects: [
    { name: 'desktop-chromium', testIgnore: '**/*.api.e2e.spec.ts', use: { ...devices['Desktop Chrome'] } },
    { name: 'android-chrome', testIgnore: '**/*.api.e2e.spec.ts', use: { ...devices['Pixel 7'] } },
    { name: 'ios-webkit', testIgnore: '**/*.api.e2e.spec.ts', use: { ...devices['iPhone 13'] } },
    /* Both phone projects are portrait, which leaves the 601-820px band unexercised —
       a phone turned sideways and a tablet held upright report desktop-class widths
       while still being fingers on glass. */
    {
      name: 'android-landscape',
      testMatch: '**/mobile-usability.e2e.spec.ts',
      use: { ...devices['Pixel 7 landscape'] },
    },
    { name: 'api', testMatch: '**/*.api.e2e.spec.ts', use: { baseURL: apiBaseURL } },
  ],
});
