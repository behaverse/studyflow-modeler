import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Project-wide specs in tests/, each package's under packages/<name>/tests/, each skill's under skills/<name>/tests/.
  testDir: '.',
  testIgnore: ['**/node_modules/**', '**/dist/**', 'playwright-report/**', 'test-results/**'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  projects: [
    // Node-side unit specs, browserless; `test:unit` runs them via playwright.unit.config.ts.
    {
      name: 'unit',
      testMatch: '**/*.unit.spec.ts',
      fullyParallel: true,
    },
    // Browser specs against the one editor the app ships.
    {
      name: 'e2e',
      testIgnore: ['**/node_modules/**', '**/dist/**', '**/*.unit.spec.ts', '**/*.webkit.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    // WebKit renders SVG differently enough to lose things Chromium draws — canvas icons went
    // missing in Safari for exactly that reason. Anything engine-sensitive belongs here.
    {
      name: 'webkit',
      testMatch: '**/*.webkit.spec.ts',
      use: {
        ...devices['Desktop Safari'],
      },
    },
  ],
  // One dev server, one origin: the modeler (4173) hosts the runner under /run/,
  // mirroring how the merged dist/ is served in production.
  webServer: {
    command: 'npm run dev -w @behaverse/studyflow-modeler -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/app.html',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 120 * 1000,
  },
});
