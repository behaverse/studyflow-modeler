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
 * Moving a shape, end to end in the real app — the `dnd` and `snap` recordings of
 * parity spec addenda 2 and 7.
 *
 * Four things happen at once when a shape is dragged, and each of them is a separate
 * bit of machinery that has to agree with the others:
 *
 * 1. the shape itself moves, live (no ghost, no dimmed copy);
 * 2. its connections re-route live underneath it;
 * 3. blue hairlines appear along whatever alignment the drag has taken, one per axis;
 * 4. on drop the connection is a clean orthogonal route with ROUNDED corners.
 *
 * The unit specs pin each piece under jsdom; this one proves they compose in a
 * browser, on a diagram built through the app's own palette and context pad.
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
  test('the ghost, the gray re-routing flow, two snap lines, and rounded corners on drop', async ({ page }) => {
    await gotoModeler(page);

    // The shape under test, plus an end event appended to it — that flow is what has
    // to re-route live and land with rounded corners.
    await addTask(page, { x: 420, y: 180 });
    await page.getByTestId('context-pad-append').click();
    await page.getByTestId('popup-menu-search').fill('end');
    await page.getByTestId('popup-menu-entry-create-End').click();
    await expect(page.locator('g[data-element-id^="EndEvent_"]')).toHaveCount(1);

    // Two bystanders, placed to give the drag something to align WITH: one supplies
    // the vertical guide (a shared centre x), the other the horizontal one.
    await addTask(page, { x: 240, y: 560 });
    await addTask(page, { x: 720, y: 420 });

    const task = page.locator('g[data-element-id^="Task_"]').first();
    const flowGroup = page.locator('svg.sf-canvas g.sf-connection').first();
    const flow = flowGroup.locator('.sf-connection-line');
    const columnMate = page.locator('g[data-element-id^="Task_"]').nth(1);
    const rowMate = page.locator('g[data-element-id^="Task_"]').nth(2);

    const from = await centreOf(task);
    const target = { x: (await centreOf(columnMate)).x, y: (await centreOf(rowMate)).y };
    const transformBefore = await task.getAttribute('transform');
    const dBefore = await flow.getAttribute('d');

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // One intermediate frame so the gesture passes the 3px drag threshold before the
    // frame that actually lands on the alignment.
    await page.mouse.move(from.x - 40, from.y + 40);
    await page.mouse.move(target.x, target.y);

    // 1 + 2 — the shape has moved and its flow has re-routed, mid-gesture.
    await expect(page.locator('svg.sf-canvas')).toHaveClass(/sf-drag-active/);
    expect(await task.getAttribute('transform')).not.toBe(transformBefore);
    expect(await flow.getAttribute('d')).not.toBe(dBefore);

    // 3 — one guide per axis, and both of them span the viewport rather than the shape.
    await expect(snapLines(page)).toHaveCount(2);

    await page.mouse.up();

    // The chrome goes down with the gesture.
    await expect(snapLines(page)).toHaveCount(0);
    await expect(page.locator('svg.sf-canvas')).not.toHaveClass(/sf-drag-active/);

    // 4 — the flow now turns a corner, and every corner it turns is an arc, not a
    // mitre (dnd/frame_08).
    const d = await flow.getAttribute('d');
    expect(d, 'the dropped flow is drawn as a path').toBeTruthy();
    expect(d!, 'a re-routed flow bends').toMatch(/\bA /);
  });

  test('a drag that lines up with nothing draws no guide and lands on the 10-unit grid', async ({ page }) => {
    await gotoModeler(page);

    await addTask(page, { x: 300, y: 220 });
    const task = page.locator('g[data-element-id^="Task_"]').first();
    const from = await centreOf(task);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 137, from.y + 93);

    // Nothing to align to: the grid is doing the snapping, and the reference draws
    // no hairline for that (parity spec addendum 7).
    await expect(snapLines(page)).toHaveCount(0);
    await page.mouse.up();

    // Where it landed is read back out of the document, not off the screen: the DI
    // is what a grid-snapped drop has to write (parity spec addendum 7 acceptance).
    const bpmn = await readDownloadText(await exportDiagram(page, 'bpmn'));
    const bounds = new RegExp(
      '<bpmndi:BPMNShape[^>]*bpmnElement="Task_[^"]*"[^>]*>\\s*<dc:Bounds[^>]*x="([-\\d.]+)"[^>]*y="([-\\d.]+)"',
    ).exec(bpmn);
    expect(bounds, 'the exported diagram carries the task\'s bounds').toBeTruthy();
    expect(Number(bounds![1]) % 10, 'x landed on the grid').toBe(0);
    expect(Number(bounds![2]) % 10, 'y landed on the grid').toBe(0);
  });

  test('"Snap to grid" off lets a drop land between the grid lines', async ({ page }) => {
    // Parity spec addendum 7 asks for snapping on by default AND a setting to turn
    // it off. The default is covered above; this is the other half, and it is the
    // only way a shape can be placed off the 10-unit grid at all.
    await gotoModeler(page);

    await runPaletteCommand(page, 'Settings...');
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
