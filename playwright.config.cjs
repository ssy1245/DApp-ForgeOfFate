const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  projects: [
    { name: 'game', testDir: './tests/browser' },
    { name: 'chain', testDir: './chain/tests/browser' },
  ],
  timeout: 90000,
  expect: { timeout: 12000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  outputDir: 'test-results/browser',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    browserName: 'chromium', actionTimeout: 15000, navigationTimeout: 30000,
    // Uses installed Chrome; omit channel with FORGE_TEST_CHROMIUM=1 after installing Chromium.
    channel: process.env.FORGE_TEST_CHROMIUM === '1' ? undefined : 'chrome',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
});
