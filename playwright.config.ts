import { defineConfig, devices } from '@playwright/test';

const e2ePort = Number(process.env.AICARD_E2E_PORT ?? 4280);
const e2eOrigin = `http://localhost:${e2ePort}`;
const referenceProductPort = Number(process.env.REFERENCE_PRODUCT_E2E_PORT ?? 4281);
const referenceProductOrigin = `http://localhost:${referenceProductPort}`;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: e2eOrigin,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: [
    {
      command: `APP_ORIGIN=${e2eOrigin} WEBAUTHN_ORIGIN=${e2eOrigin} NODE_ENV=test node --env-file-if-exists=.env.local node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port ${e2ePort}`,
      url: e2eOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `AI_CARD_ORIGIN=${e2eOrigin} AI_CARD_INTERNAL_ORIGIN=http://127.0.0.1:${e2ePort} REFERENCE_PRODUCT_ORIGIN=${referenceProductOrigin} REFERENCE_PRODUCT_PORT=${referenceProductPort} npm run dev:reference-product`,
      url: referenceProductOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
