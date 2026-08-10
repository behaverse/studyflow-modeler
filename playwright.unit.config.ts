import { defineConfig } from '@playwright/test';

/** The fast lane (`test:unit`, `lint:schemas`): Node-side unit specs, no dev server. */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.unit.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html']] : 'list',
});
