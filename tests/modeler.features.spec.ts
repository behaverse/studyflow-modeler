import { expect, test } from '@playwright/test';
import { SCHEMAS as NODE_SCHEMAS } from './schemas';
import { gotoModeler, onCanvasBackend, runPaletteCommand } from './utils';

/** Publish / Gantt / Settings / token simulator, plus the loader-vs-Node-twin equivalence check. */

test('the app loader and the Node twin agree on the schema manifest', async ({ page }) => {
  await gotoModeler(page);
  const appSchemas = await page.evaluate(() =>
    window.__studyflowTest!.schemas.map(({ prefix, name, core, uri }) => ({ prefix, name, core, uri })));
  const nodeSchemas = NODE_SCHEMAS.map(({ prefix, name, core, uri }) => ({ prefix, name, core, uri }));
  expect(appSchemas).toEqual(nodeSchemas);
});

test('the Publish dialog opens, and a bogus key fails inline (not via alert)', async ({ page }) => {
  await gotoModeler(page);
  await runPaletteCommand(page, 'Publish...');
  const dialog = page.getByTestId('publish-dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('textbox', { name: 'Study Name' }).fill('test-study');
  await dialog.getByRole('textbox', { name: 'Behaverse API Key' }).fill('bogus');
  // The publish endpoint always fails here; the failure must render inside the dialog, per the notices house rule.
  await dialog.getByRole('button', { name: 'Publish' }).click();
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

test('the token simulator runs: a token appears and Stop restores editing', async ({ page }) => {
  // P6b: token simulation is a bpmn-js command-stack/DI feature (`simulation/module.ts`)
  // with no canvas counterpart yet; `canvasBackend.ts` reports it off rather than lying.
  test.skip(onCanvasBackend(), 'P6b: token simulation is not implemented on the canvas backend');
  await gotoModeler(page);
  await page.getByRole('button', { name: 'Simulate' }).click();
  await expect(page.locator('[data-testid="modeler-app"]')).toHaveClass(/simulation-active/);
  // A running simulation drops a token on the canvas, drawn as an SVG circle by tokenVisual.
  await expect(page.locator('.studyflow-simulation-token').first()).toBeVisible();
  await page.getByTitle('Stop simulation').click();
  await expect(page.locator('[data-testid="modeler-app"]')).not.toHaveClass(/simulation-active/);
});
