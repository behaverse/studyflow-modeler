import { expect, test, type Locator, type Page } from '@playwright/test';

import { addPaletteElement, gotoModeler, pressOnCanvas } from './utils';

/**
 * The per-shape context pad, driven by a real pointer. `tests/context-pad-entries.unit.spec.ts`
 * pins WHICH entries appear, the canvas specs where the pad floats and that a ghost is where
 * the click lands; what needs a browser is the pad following the selection, what a hover
 * paints, and an entry's edit reaching the canvas. `tests/modeler.popup.spec.ts` covers the
 * menus the pad opens.
 */

const pad = (page: Page): Locator => page.getByTestId('context-pad');
const entry = (page: Page, action: string): Locator => page.getByTestId(`context-pad-${action}`);

/**
 * The page-space MIDDLE of a rendered connection, taken from the path itself.
 *
 * Not the centre of its bounding box: a two-point horizontal flow has a zero-height
 * box whose centre rounds onto whichever shape is nearest, and a click there lands on
 * the shape instead of the flow every few runs. `getPointAtLength` is exact for any
 * path shape.
 */
async function pointOnPath(locator: Locator): Promise<{ x: number; y: number }> {
  return locator.evaluate((el) => {
    const path = el as unknown as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = point.matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
}

/** The hover ghost: one `<g>` in the overlay layer, holding the shape and its flow. */
const ghost = (page: Page): Locator => page.locator('.sf-append-preview');

test.describe('The context pad', () => {
  test('an append entry ghosts what its click makes, the pad follows the selection, and on a flow it toggles the default', async ({ page }) => {
    await gotoModeler(page);
    await addPaletteElement(page, 'Activities', 'Task', { x: 260, y: 220 });
    await pressOnCanvas(page, 'Escape');
    await addPaletteElement(page, 'Activities', 'User', { x: 560, y: 220 });
    await pressOnCanvas(page, 'Escape');
    const task = page.locator('g[data-element-id^="Task_"]').first();
    const target = entry(page, 'append.end-event');
    await task.click();

    // One ghost, carrying both halves of what the click would make: the silhouette and
    // the connection that would reach it. Nothing is committed, and a tooltip comes with it.
    await expect(ghost(page)).toHaveCount(0);
    await target.hover();
    await expect(ghost(page)).toHaveCount(1);
    await expect(ghost(page).locator('.sf-ghost')).toHaveCount(1);
    await expect(ghost(page).locator('.sf-append-preview-line')).toHaveCount(1);
    await expect(page.locator('g[data-element-id^="EndEvent_"]')).toHaveCount(0);
    await expect(page.getByTestId('context-pad-tooltip')).toHaveText(/end event/i);

    // Leaving takes both away.
    await page.mouse.move(10, 10);
    await expect(ghost(page)).toHaveCount(0);
    await expect(page.getByTestId('context-pad-tooltip')).toHaveCount(0);

    // The ghost belongs to the source it was computed from: selecting elsewhere moves the
    // pad out from under the pointer, and the `mouseleave` that never comes must not
    // strand a shape nothing owns.
    await target.hover();
    await expect(ghost(page)).toHaveCount(1);
    await page.locator('g[data-element-id^="UserTask_"]').first().click();
    await expect(ghost(page)).toHaveCount(0);

    // The pad belongs to the selection: clearing it closes the pad, selecting opens it again.
    await page.getByTestId('modeler-canvas').click({ position: { x: 60, y: 60 } });
    await expect(pad(page)).toHaveCount(0);
    await task.click();
    await expect(pad(page)).toBeVisible();

    // The click commits it; on the flow it drew, the pad toggles the default: the slash at the
    // flow's start, then gone again.
    await target.click();
    await expect(page.locator('g[data-element-id^="EndEvent_"]')).toHaveCount(1);
    const flowLine = page.locator('svg.sf-canvas g.sf-connection .sf-connection-line').first();
    const mid = await pointOnPath(flowLine);
    await page.mouse.click(mid.x, mid.y);
    await entry(page, 'flow.toggle-default').click();
    await expect(flowLine).toHaveAttribute('marker-start', /^url\(#/);
    await entry(page, 'flow.toggle-default').click();
    await expect(flowLine).not.toHaveAttribute('marker-start', /./);
  });
});
