import { defineConfig } from '@playwright/test';

/** The fast lane (`test:unit`, `lint:schemas`): Node-side unit specs, no dev server. */
export default defineConfig({
  // Project-wide specs in tests/, each package's under packages/<name>/tests/, each skill's under skills/<name>/tests/.
  testDir: '.',
  testIgnore: ['**/node_modules/**', '**/dist/**', 'playwright-report/**', 'test-results/**'],
  testMatch: '**/*.unit.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html']] : 'list',
});
