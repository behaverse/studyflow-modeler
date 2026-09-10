import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** The fast lane (`test:unit`): the unit project alone, browserless, without the dev server, fully parallel, unretried. */
export default defineConfig({
  ...base,
  projects: base.projects!.filter((project) => project.name === 'unit'),
  webServer: undefined,
  fullyParallel: true,
  retries: 0,
  workers: undefined,
  reporter: process.env.CI ? [['list'], ['html']] : 'list',
});
