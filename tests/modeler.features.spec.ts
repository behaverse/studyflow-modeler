import { expect, test } from '@playwright/test';
import { SCHEMAS as NODE_SCHEMAS } from './schemas';
import { gotoModeler, runPaletteCommand } from './utils';

/** Publish / Gantt / Settings / token simulator, plus the loader-vs-Node-twin equivalence check. */

test('the app loader and the Node twin agree on the schema manifest', async ({ page }) => {
  await gotoModeler(page);
  const appSchemas = await page.evaluate(() =>
    window.__studyflowTest!.schemas.map(({ prefix, name, core, uri }) => ({ prefix, name, core, uri })));
  const nodeSchemas = NODE_SCHEMAS.map(({ prefix, name, core, uri }) => ({ prefix, name, core, uri }));
  expect(appSchemas).toEqual(nodeSchemas);
});

test('publishing is a destination in the Save dialog, and a bogus key fails inline (not via alert)', async ({ page }) => {
  await gotoModeler(page);
  await runPaletteCommand(page, 'Save As...');
  const dialog = page.getByTestId('save-dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByTestId('save-to-cloud').click();
  await dialog.getByRole('textbox', { name: 'Study name' }).fill('test-study');
  await dialog.getByLabel('Behaverse API key').fill('bogus');
  // The publish endpoint always fails here; the failure must render inside the dialog, per the notices house rule.
  await dialog.getByTestId('save-submit').click();
  await expect(dialog.locator('.text-red-500')).toBeVisible();
});

test('the Gantt view opens from the command palette', async ({ page }) => {
  await gotoModeler(page);
  await runPaletteCommand(page, 'View as Gantt...');
  await expect(page.getByRole('heading', { name: 'Gantt View' })).toBeVisible();
});

test('the Settings view opens and its Extensions section lists every schema', async ({ page }) => {
  await gotoModeler(page);
  await runPaletteCommand(page, 'Settings...');
  await page.getByText('Extensions', { exact: true }).first().click();
  for (const schema of NODE_SCHEMAS) {
    await expect(page.getByRole('switch', { name: `Load the ${schema.name} elements` })).toBeAttached();
  }
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
