import { expect, test } from '@playwright/test';
import { SCHEMAS as NODE_SCHEMAS } from './schemas';
import { gotoModeler, runPaletteCommand } from './utils';

/** Gantt / Settings / token simulator. */

test('the Gantt view opens from the command palette', async ({ page }) => {
  await gotoModeler(page);
  await runPaletteCommand(page, 'View as Gantt...');
  await expect(page.getByRole('heading', { name: 'Gantt View' })).toBeVisible();
});

test('the Settings view opens and its Extensions section lists every schema, a required one locked on', async ({ page }) => {
  await gotoModeler(page);
  await runPaletteCommand(page, 'Settings');
  await page.getByText('Extensions', { exact: true }).first().click();
  for (const schema of NODE_SCHEMAS) {
    const toggle = page.getByRole('switch', { name: `Load the ${schema.name} elements` });
    await expect(toggle).toBeAttached();
    if (schema.required) await expect(toggle).toBeDisabled();
  }
  await expect(page.getByRole('img', { name: 'required', exact: true })).toHaveCount(NODE_SCHEMAS.filter((schema) => schema.required).length);
});

// P6b §3D: one simulator now drives both backends — `TokenSimulator` runs off the
// `Editor` (`events` / `elements.filter` / `canvas.getHostLayer('token-simulation')`),
// so this spec is backend-neutral like the rest of the suite.
test('the token simulator runs: a token appears and Stop restores editing', async ({ page }) => {
  await gotoModeler(page);
  await page.getByRole('button', { name: 'Simulate' }).click();
  await expect(page.locator('[data-testid="modeler-app"]')).toHaveClass(/simulation-active/);
  // A running simulation drops a token on the canvas, drawn as an SVG circle by tokenVisual.
  await expect(page.locator('.studyflow-simulation-token').first()).toBeVisible();
  await page.getByTitle('Stop simulation').click();
  await expect(page.locator('[data-testid="modeler-app"]')).not.toHaveClass(/simulation-active/);
});
