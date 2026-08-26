import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
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
    {
      name: 'e2e',
      testIgnore: '**/*.unit.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    // P6a: the same suite, driven against the native canvas backend through the
    // `?editor=canvas` flag (`tests/utils.ts::editorBackend`). One spec set, two
    // backends — never a per-backend fork. `STUDYFLOW_EDITOR_BACKEND` overrides
    // the project name for ad-hoc runs of the default project.
    {
      name: 'e2e-canvas',
      testIgnore: '**/*.unit.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  // Two dev servers, one origin: the modeler (4173) proxies /run and friends to
  // the runner (4174), mirroring how the merged dist/ is served in production.
  webServer: [
    {
      command: 'npm run dev -w @behaverse/studyflow-modeler -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173/app.html',
      env: { RUNNER_PORT: '4174' },
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: 120 * 1000,
    },
    {
      command: 'npm run dev -w @behaverse/studyflow-runner -- --host 127.0.0.1 --port 4174',
      url: 'http://127.0.0.1:4174/run/',
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: 120 * 1000,
    },
  ],
});
