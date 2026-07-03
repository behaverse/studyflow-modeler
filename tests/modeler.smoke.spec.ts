import { expect, test } from '@playwright/test';

import { gotoModeler, openCommandPalette } from './utils';

test.describe('Studyflow modeler smoke', () => {
  test('loads the modeler shell', async ({ page }) => {
    await gotoModeler(page);

    await expect(page.getByRole('button', { name: 'Open command palette' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Simulate' })).toBeVisible();

    await openCommandPalette(page);
    const dialog = page.getByRole('dialog');
    // Group headers ('Run' is skipped: it collides with the Run command label).
    await expect(dialog.getByText('File', { exact: true })).toBeVisible();
    await expect(dialog.getByText('View', { exact: true })).toBeVisible();
    await expect(dialog.getByText('App', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await expect(page.getByTestId('palette-root')).toBeVisible();
    await expect(page.getByTestId('inspector-shell')).toBeAttached();
    await expect(page.getByTestId('inspector-root')).toBeVisible();
    await expect(page.getByTestId('modeler-loading')).toHaveCount(0);
  });
});