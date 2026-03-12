import { expect, test } from '@playwright/test';

import { gotoModeler } from './utils';

test.describe('Studyflow modeler smoke', () => {
  test('loads the modeler shell', async ({ page }) => {
    await gotoModeler(page);

    await expect(page.getByRole('button', { name: 'File' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Help' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Simulate' })).toBeVisible();
    await expect(page.getByTestId('palette-root')).toBeVisible();
    await expect(page.getByTestId('inspector-shell')).toBeAttached();
    await expect(page.getByTestId('inspector-root')).toBeVisible();
    await expect(page.getByTestId('modeler-loading')).toHaveCount(0);
  });
});