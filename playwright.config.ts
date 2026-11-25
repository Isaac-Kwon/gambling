import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);

// ARCHITECTURE 11.4: iPhone 13 (WebKit) and Pixel 7 (Chromium) against a BASE_PATH=/gambling/ build served by vite preview.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'ko-KR',
    serviceWorkers: 'block', // the offline scenario opts back in; everything else stays deterministic
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'iphone-13', use: { ...devices['iPhone 13'] } },
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node e2e/serve.mjs',
    url: `http://127.0.0.1:${PORT}/gambling/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
