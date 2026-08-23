import { defineConfig } from 'vitest/config';

const resultsDir = process.env.ALLURE_RESULTS_DIR || 'allure-results';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['allure-vitest/setup'],
    reporters: [
      'default',
      ['allure-vitest/reporter', {
        resultsDir,
        environmentInfo: {
          execution: 'Docker Compose',
          test_layers: 'unit, API, contract, component',
        },
      }],
    ],
  },
});
