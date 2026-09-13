import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  addPaletteElement,
  exportDiagram,
  gotoModeler,
  pressOnCanvas,
  readDownloadText,
  runPaletteCommand,
} from './utils';

/**
 * The "Snap to grid" setting, end to end. The grid and the alignment snaps a move
 * runs under are pinned in jsdom (`packages/canvas/tests/canvas-snapping.unit.spec.ts`);
 * what needs the app is the Settings switch that turns the grid off.
 */

const snapLines = (page: Page): Locator => page.locator('svg.sf-canvas .sf-snap-line');

/** The centre of a rendered element, in page coordinates. */
async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element is not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Place a task and dismiss the label editor a fresh task opens. */
async function addTask(page: Page, at: { x: number; y: number }): Promise<void> {
  await addPaletteElement(page, 'Activities', 'Task', at);
  await pressOnCanvas(page, 'Escape');
}

test.describe('Moving a shape', () => {
  test('"Snap to grid" off lets a drop land between the grid lines', async ({ page }) => {
    // Snapping is on out of the box; switching it off is the only way to place a
    // shape off the 10-unit grid.
    await gotoModeler(page);

    await runPaletteCommand(page, 'Settings');
    await page.getByText('Editor', { exact: true }).first().click();
    const toggle = page.getByRole('switch', { name: 'Snap to grid' });
    await expect(toggle).toBeVisible();
    await expect(toggle, 'snapping is on out of the box').toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    // Escape closes Settings and hands the canvas back.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('modeler-canvas')).toBeVisible();

    await addTask(page, { x: 300, y: 220 });
    const task = page.locator('g[data-element-id^="Task_"]').first();
    const from = await centreOf(task);

    // A deliberately un-round delta, dropped where nothing can align to it: with the
    // snap off, the offset survives into the DI instead of being quantized away.
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 137, from.y + 93, { steps: 8 });
    await expect(snapLines(page)).toHaveCount(0);
    await page.mouse.up();

    const bpmn = await readDownloadText(await exportDiagram(page, 'bpmn'));
    const bounds = new RegExp(
      '<bpmndi:BPMNShape[^>]*bpmnElement="Task_[^"]*"[^>]*>\\s*<dc:Bounds[^>]*x="([-\\d.]+)"[^>]*y="([-\\d.]+)"',
    ).exec(bpmn);
    expect(bounds, 'the exported diagram carries the task\'s bounds').toBeTruthy();
    const offGrid = Number(bounds![1]) % 10 !== 0 || Number(bounds![2]) % 10 !== 0;
    expect(offGrid, `expected an off-grid landing, got ${bounds![1]},${bounds![2]}`).toBe(true);
  });
});
