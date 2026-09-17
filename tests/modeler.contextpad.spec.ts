import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  addPaletteElement,
  exportDiagram,
  gotoModeler,
  pressOnCanvas,
  readDownloadText,
} from './utils';

/**
 * The per-shape context pad, driven by a real pointer. `tests/context-pad-entries.unit.spec.ts`
 * pins WHICH entries appear; what needs a browser is where the box floats and when it gets
 * out of the way, what a hover paints, and that the ghost a hover paints is where a click
 * lands. `tests/modeler.popup.spec.ts` covers the menus the pad opens.
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

/** A bounding box, rounded, so two measurements of the same geometry compare. */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  expect(box, 'expected the element to have a box').not.toBeNull();
  return {
    x: Math.round(box!.x),
    y: Math.round(box!.y),
    width: Math.round(box!.width),
    height: Math.round(box!.height),
  };
}

test.describe('The context pad', () => {
  test('floats just outside the selection outline, steps aside for a drag, and goes with the selection', async ({ page }) => {
    await gotoModeler(page);
    await addPaletteElement(page, 'Activities', 'Task', { x: 300, y: 220 });
    await pressOnCanvas(page, 'Escape');
    const task = page.locator('g[data-element-id^="Task_"]').first();

    // `left = outline.right + 8`, `top = outline.top`, the outline 5 diagram units outside
    // the shape; the tolerance absorbs the zoom the initial fit chooses and the rounding.
    await expect(pad(page)).toBeVisible();
    const shape = await boxOf(task);
    const padBox = await boxOf(pad(page));
    expect(padBox.x).toBeGreaterThan(shape.x + shape.width);
    expect(padBox.x - (shape.x + shape.width)).toBeLessThan(40);
    expect(Math.abs(padBox.y - shape.y)).toBeLessThan(30);

    // Gone for the length of a drag, so the trash is not under the pointer at the drop;
    // back after it, anchored where the shape landed.
    await page.mouse.move(shape.x + shape.width / 2, shape.y + shape.height / 2);
    await page.mouse.down();
    await page.mouse.move(shape.x + shape.width / 2 + 160, shape.y + shape.height / 2 + 80, { steps: 12 });
    await expect(pad(page)).toBeHidden();
    await page.mouse.up();
    await expect(pad(page)).toBeVisible();
    const moved = await boxOf(task);
    const movedPad = await boxOf(pad(page));
    expect(movedPad.x).toBeGreaterThan(moved.x + moved.width);
    expect(Math.abs(movedPad.y - moved.y)).toBeLessThan(30);

    // It belongs to the selection: clearing it closes the pad, selecting opens it again.
    await page.getByTestId('modeler-canvas').click({ position: { x: 60, y: 60 } });
    await expect(pad(page)).toHaveCount(0);
    await task.click();
    await expect(pad(page)).toBeVisible();
  });

  test('hovering the end-event entry ghosts the shape and its flow where the click lands them', async ({ page }) => {
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

    // The click lands exactly on the ghost. Compared as the renderer's own placement, the
    // `<g transform>` and the geometry inside it: a selected shape's outline would make two
    // bounding boxes of one placement differ.
    await task.click();
    await target.hover();
    await expect(ghost(page)).toHaveCount(1);
    const placement = (locator: Locator) => locator.evaluate((node: any) => ({
      transform: node.getAttribute('transform'),
      geometry: node.querySelector(':scope > :not(.sf-outline)').outerHTML,
    }));
    const previewed = await placement(ghost(page).locator('.sf-ghost'));
    await target.click();
    await expect(ghost(page)).toHaveCount(0);
    const created = page.locator('g[data-element-id^="EndEvent_"]');
    await expect(created).toHaveCount(1);
    expect(await placement(created), 'the ghost and the commit place and draw the shape alike').toEqual(previewed);
  });

  test('the connect entry drags a live preview onto another shape and mints the flow', async ({ page }) => {
    await gotoModeler(page);
    await addPaletteElement(page, 'Activities', 'Task', { x: 260, y: 220 });
    await pressOnCanvas(page, 'Escape');
    await addPaletteElement(page, 'Activities', 'User', { x: 560, y: 220 });
    await pressOnCanvas(page, 'Escape');

    // Re-select the source: the pad belongs to whatever is selected, and the second
    // create left the user task selected.
    await page.locator('g[data-element-id^="Task_"]').first().click();
    await expect(entry(page, 'connect')).toBeVisible();

    // `hover()` rather than a `boundingBox()` + `mouse.move()` pair, because the pad
    // is positioned on an animation frame: a box read in the frame after the
    // selection changed still describes where the pad WAS, and pressing there lands
    // on empty canvas. `hover()` waits for the box to hold still across two frames.
    await entry(page, 'connect').hover();
    const to = (await page.locator('g[data-element-id^="UserTask_"]').first().boundingBox())!;

    // The gesture starts on PRESS, not on click — the entry is dragged out of the pad.
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });

    // Over a target the rules accept, the rubber band goes solid with an arrowhead.
    const preview = page.locator('.sf-connect-preview');
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute('data-status', 'ok');

    await page.mouse.up();
    await expect(preview).toHaveCount(0);

    const bpmn = await readDownloadText(await exportDiagram(page, 'bpmn'));
    expect(bpmn).toMatch(/<bpmn2:sequenceFlow[^>]*sourceRef="Task_[^"]*"[^>]*targetRef="UserTask_/);
  });

  test('the wrench retypes the element through the replace menu, as one undo step', async ({ page }) => {
    // What the retype writes (the new type, the name, both flows) is canvas-replace's.
    await gotoModeler(page);
    await addPaletteElement(page, 'Activities', 'Task', { x: 300, y: 220 });
    await page.keyboard.type('Read the brief');
    await pressOnCanvas(page, 'Escape');
    await entry(page, 'append.end-event').click();

    const task = page.locator('g[data-element-id^="Task_"]');
    await task.first().click();
    await expect(entry(page, 'replace')).toBeVisible();
    await entry(page, 'replace').click();

    // The wrench opens a searchable menu, as `append` does.
    await expect(page.getByTestId('popup-menu')).toBeVisible();
    await page.getByTestId('popup-menu-entry-create-User').click();

    // The task is gone and a user task stands where it stood, under the same name (drawn on two lines).
    await expect(task).toHaveCount(0);
    await expect(page.locator('g[data-element-id^="UserTask_"]')).toContainText(/Read the\s*brief/);

    // ONE undo, because the whole retype was one edit.
    await pressOnCanvas(page, 'ControlOrMeta+z');
    await expect(task).toHaveCount(1);
    await expect(page.locator('g[data-element-id^="UserTask_"]')).toHaveCount(0);
  });

  test('a selected sequence flow offers the annotate entry, and it hangs a note off the flow', async ({ page }) => {
    // A `bpmn:Association` may leave a sequence flow, so the note hangs off the flow
    // itself rather than off either of its ends.
    await gotoModeler(page);
    await addPaletteElement(page, 'Activities', 'Task', { x: 300, y: 240 });
    await pressOnCanvas(page, 'Escape');
    await entry(page, 'append.end-event').click();

    const flowLine = page.locator('svg.sf-canvas g.sf-connection .sf-connection-line').first();
    const mid = await pointOnPath(flowLine);
    await page.mouse.click(mid.x, mid.y);

    await expect(pad(page)).toBeVisible();
    // The default-flow toggle comes with it, because this flow leaves an activity.
    await expect(entry(page, 'append.text-annotation')).toBeVisible();
    await expect(entry(page, 'flow.toggle-default')).toBeVisible();
    // The two that need a shape to flow OUT of stay away.
    await expect(entry(page, 'connect')).toHaveCount(0);
    await expect(entry(page, 'append.end-event')).toHaveCount(0);

    // Toggling default draws the slash at the flow's start, and toggling again
    // removes it — one attribute on the source, round-tripped as `default="..."`.
    await entry(page, 'flow.toggle-default').click();
    await expect(flowLine).toHaveAttribute('marker-start', /^url\(#/);
    await entry(page, 'flow.toggle-default').click();
    await expect(flowLine).not.toHaveAttribute('marker-start', /./);

    // Hovering ghosts the note above the flow; clicking commits exactly it.
    await entry(page, 'append.text-annotation').hover();
    await expect(ghost(page)).toHaveCount(1);
    await entry(page, 'append.text-annotation').click();
    await expect(page.locator('g[data-element-id^="TextAnnotation_"]')).toHaveCount(1);

    const bpmn = await readDownloadText(await exportDiagram(page, 'bpmn'));
    expect(bpmn).toContain('<bpmn2:textAnnotation');
    expect(bpmn).toMatch(/<bpmn2:association[^>]*sourceRef="(SequenceFlow|Flow)_/);
  });
});
