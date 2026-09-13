import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  addPaletteElement,
  exportDiagram,
  gotoModeler,
  labelEditor,
  pressOnCanvas,
  readDownloadText,
} from './utils';

/**
 * The per-shape context pad, driven the way a pointer drives it (parity spec
 * addenda 4+5, ux-spec §4; reference recordings `edge-videos/edgemake` and
 * `edge-videos/preview`).
 *
 * `tests/context-pad-entries.unit.spec.ts` pins WHICH entries appear; everything
 * here needs a real pointer and a real canvas: where the box floats, what a hover
 * paints, and that the ghost a hover paints is the element a click actually creates.
 * That last one is the whole point of the affordance (addendum 5 §3) and the only
 * way to catch it drifting is to measure both.
 *
 * `tests/modeler.popup.spec.ts` covers the two menus the pad opens.
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
  test('floats just outside the selection outline, at its top-right corner', async ({ page }) => {
    await gotoModeler(page);
    await addPaletteElement(page, 'Activities', 'Task', { x: 300, y: 220 });
    await pressOnCanvas(page, 'Escape');

    await expect(pad(page)).toBeVisible();
    const shape = await boxOf(page.locator('g[data-element-id^="Task_"]').first());
    const padBox = await boxOf(pad(page));

    // ux-spec §4: `left = selectionOutline.right + 8`, `top = selectionOutline.top`,
    // and the outline itself sits 5 diagram units outside the shape. At zoom 1 that
    // is shape.right + 13 and shape.top - 5; the tolerance absorbs the zoom the
    // initial fit chooses and the rounding on both sides.
    expect(padBox.x).toBeGreaterThan(shape.x + shape.width);
    expect(padBox.x - (shape.x + shape.width)).toBeLessThan(40);
    expect(Math.abs(padBox.y - shape.y)).toBeLessThan(30);
    // The 98px box is what makes the entries wrap three to a row.
    expect(padBox.width).toBe(98);
  });

  test('hovering the end-event entry ghosts the shape and its flow, and leaving removes both', async ({ page }) => {
    await gotoModeler(page);
    await addPaletteElement(page, 'Activities', 'Task', { x: 300, y: 220 });
    await pressOnCanvas(page, 'Escape');

    await expect(ghost(page)).toHaveCount(0);
    await entry(page, 'append.end-event').hover();

    // One ghost, carrying both halves of what the click would make: the silhouette
    // in drag-blue and the connection that would reach it (`preview/frame_02`).
    await expect(ghost(page)).toHaveCount(1);
    await expect(ghost(page).locator('.sf-ghost')).toHaveCount(1);
    await expect(ghost(page).locator('.sf-append-preview-line')).toHaveCount(1);
    // Nothing was committed: the document still holds exactly one shape.
    await expect(page.locator('g[data-element-id^="EndEvent_"]')).toHaveCount(0);

    // A tooltip comes with it (addendum 5 §2).
    await expect(page.getByTestId('context-pad-tooltip')).toHaveText('Append end event');

    await page.mouse.move(10, 10);
    await expect(ghost(page)).toHaveCount(0);
    await expect(page.getByTestId('context-pad-tooltip')).toHaveCount(0);
  });

  test('the ghost dies when the selection moves out from under it', async ({ page }) => {
    await gotoModeler(page);
    await addPaletteElement(page, 'Activities', 'Task', { x: 260, y: 220 });
    await pressOnCanvas(page, 'Escape');
    await addPaletteElement(page, 'Activities', 'User', { x: 560, y: 220 });
    await pressOnCanvas(page, 'Escape');

    await page.locator('g[data-element-id^="Task_"]').first().click();
    await entry(page, 'append.end-event').hover();
    await expect(ghost(page)).toHaveCount(1);

    // Selecting elsewhere re-anchors the pad. The ghost belongs to the source it was
    // computed from, so it must not survive the source going away — a `mouseleave`
    // that never arrives (the pad moved out from under the pointer) would otherwise
    // strand a blue shape on the diagram that nothing owns.
    await page.locator('g[data-element-id^="UserTask_"]').first().click();
    await expect(ghost(page)).toHaveCount(0);
  });

  test('the ghost lands exactly where the click lands', async ({ page }) => {
    await gotoModeler(page);
    await addPaletteElement(page, 'Activities', 'Task', { x: 300, y: 220 });
    await pressOnCanvas(page, 'Escape');

    const target = entry(page, 'append.end-event');
    await target.hover();
    await expect(ghost(page)).toHaveCount(1);

    // Compared as the renderer's own placement — the `<g transform>` and the
    // untransformed geometry inside it — rather than as screen rectangles. A
    // selected shape carries an `.sf-outline` circle 6 units wider than itself, so
    // two bounding boxes of the same placement differ by exactly that halo and
    // measure the selection instead of the position.
    const placement = (locator: Locator) => locator.evaluate((node: any) => {
      const shape = node.querySelector(':scope > :not(.sf-outline)');
      return {
        transform: node.getAttribute('transform'),
        geometry: shape.outerHTML,
      };
    });

    const previewed = await placement(ghost(page).locator('.sf-ghost'));

    await target.click();
    await expect(ghost(page)).toHaveCount(0);
    const created = page.locator('g[data-element-id^="EndEvent_"]');
    await expect(created).toHaveCount(1);

    // Addendum 5 §3 — the promise the affordance makes. Both go through the same
    // `appendPosition`, so any drift here means one of them stopped.
    const landed = await placement(created);
    expect(landed.transform, 'the ghost and the commit place the shape identically')
      .toBe(previewed.transform);
    expect(landed.geometry, 'and draw the same shape at it').toBe(previewed.geometry);

    const bpmn = await readDownloadText(await exportDiagram(page, 'bpmn'));
    expect(bpmn).toContain('<bpmn2:endEvent');
    expect(bpmn).toMatch(/<bpmn2:sequenceFlow[^>]*targetRef="EndEvent_/);
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

  test('the wrench retypes the element in place, keeping its name and its flow', async ({ page }) => {
    // ux-spec §4 entry 4, the `replace` / "Change element" wrench —
    // `edge-videos/edgemake/frame_05` and `v1/frame_03` both show it between the
    // append group and the trash.
    await gotoModeler(page);
    await addPaletteElement(page, 'Activities', 'Task', { x: 300, y: 220 });
    await page.keyboard.type('Read the brief');
    await pressOnCanvas(page, 'Escape');
    await entry(page, 'append.end-event').click();

    const task = page.locator('g[data-element-id^="Task_"]');
    await task.first().click();
    await expect(entry(page, 'replace')).toBeVisible();
    await entry(page, 'replace').click();

    // The wrench opens a searchable menu, exactly as `append` does (ux-spec §11 —
    // "reached via the append/replace pad entries").
    await expect(page.getByTestId('popup-menu')).toBeVisible();
    await page.getByTestId('popup-menu-entry-create-User').click();

    // The task is gone and a user task stands where it stood…
    await expect(task).toHaveCount(0);
    const replaced = page.locator('g[data-element-id^="UserTask_"]').first();
    await expect(replaced).toHaveCount(1);

    // …with the name carried across and the flow it had re-pointed at it.
    const bpmn = await readDownloadText(await exportDiagram(page, 'bpmn'));
    expect(bpmn).toMatch(/<bpmn2:userTask[^>]*name="Read the brief"/);
    expect(bpmn).not.toContain('<bpmn2:task ');
    expect(bpmn).toMatch(/<bpmn2:sequenceFlow[^>]*sourceRef="UserTask_[^"]*"[^>]*targetRef="EndEvent_/);

    // ONE undo, because the whole retype was one edit.
    await pressOnCanvas(page, 'ControlOrMeta+z');
    await expect(task).toHaveCount(1);
    await expect(page.locator('g[data-element-id^="UserTask_"]')).toHaveCount(0);
  });

  test('switch initiating participant flips a choreography task\'s bands', async ({ page }) => {
    await gotoModeler(page);
    await addPaletteElement(page, 'Activities', 'Choreography Task', { x: 400, y: 240 });
    await page.keyboard.press('Escape');
    await expect(labelEditor(page)).toBeHidden();

    const shape = page.locator('[data-element-id^="ChoreographyTask_"]').first();
    const bandFills = () => shape.locator('path[data-band]').evaluateAll(
      // (tests are typechecked without the DOM lib, hence the `any`)
      (paths) => paths.map((p: any) => p.style.fill || p.getAttribute('fill')),
    );
    const before = await bandFills();
    expect(before).toHaveLength(2);
    expect(before[0], 'the initiating band is shaded differently to begin with').not.toBe(before[1]);

    // The app's own pad entry, contributed to diagram-js's pad while bpmn-js was the
    // editor (ux-spec §4) and re-hung on this one.
    await entry(page, 'choreography.swap-initiator').click();
    await expect.poll(bandFills).toEqual([before[1], before[0]]);

    const bpmn = await readDownloadText(await exportDiagram(page, 'bpmn'));
    expect(bpmn).toContain('initiatingParticipantRef');
  });

  test('goes away for the duration of a drag, and comes back where the shape landed', async ({ page }) => {
    // `edge-videos/dnd/frame_01` and `frame_05` show a shape being dragged with NO
    // pad riding along. Ours used to follow the ghost, so the trash and the brush sat
    // on top of the very silhouette the user was aiming — and under the cursor at the
    // moment of the drop.
    await gotoModeler(page);
    await addPaletteElement(page, 'Activities', 'Task', { x: 300, y: 220 });
    await pressOnCanvas(page, 'Escape');
    await expect(pad(page)).toBeVisible();

    const shape = await boxOf(page.locator('g[data-element-id^="Task_"]').first());
    await page.mouse.move(shape.x + shape.width / 2, shape.y + shape.height / 2);
    await page.mouse.down();
    await page.mouse.move(shape.x + shape.width / 2 + 160, shape.y + shape.height / 2 + 80, { steps: 12 });

    await expect(pad(page)).toBeHidden();

    await page.mouse.up();
    // The drop ends the gesture, and the pad returns — anchored on where the shape
    // now is, not where it was picked up.
    await expect(pad(page)).toBeVisible();
    const moved = await boxOf(page.locator('g[data-element-id^="Task_"]').first());
    const padBox = await boxOf(pad(page));
    expect(padBox.x).toBeGreaterThan(moved.x + moved.width);
    expect(Math.abs(padBox.y - moved.y)).toBeLessThan(30);
  });

  test('a selected sequence flow offers the annotate entry, and it hangs a note off the flow', async ({ page }) => {
    // ux-spec §4 — "For a connection (3 entries): `append.text-annotation`, `delete`,
    // `set-color`". A `bpmn:Association` may leave a sequence flow, so the note hangs
    // off the flow itself rather than off either of its ends.
    await gotoModeler(page);
    await addPaletteElement(page, 'Activities', 'Task', { x: 300, y: 240 });
    await pressOnCanvas(page, 'Escape');
    await entry(page, 'append.end-event').click();

    const flowLine = page.locator('svg.sf-canvas g.sf-connection .sf-connection-line').first();
    const mid = await pointOnPath(flowLine);
    await page.mouse.click(mid.x, mid.y);

    await expect(pad(page)).toBeVisible();
    // Annotate, delete, colour — plus the default-flow toggle, because this flow
    // leaves an activity.
    await expect(pad(page).locator('button')).toHaveCount(4);
    await expect(entry(page, 'append.text-annotation')).toBeVisible();
    await expect(entry(page, 'flow.toggle-default')).toBeVisible();
    // The two that need a shape to flow OUT of stay away.
    await expect(entry(page, 'connect')).toHaveCount(0);
    await expect(entry(page, 'append.end-event')).toHaveCount(0);

    // Toggling default draws the slash at the flow's start, and toggling again
    // removes it — one attribute on the source, round-tripped as `default="..."`.
    await entry(page, 'flow.toggle-default').click();
    await expect(flowLine).toHaveAttribute('marker-start', 'url(#sf-marker-default)');
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

  test('opens on selection and closes on deselection', async ({ page }) => {
    await gotoModeler(page);
    await addPaletteElement(page, 'Events', 'End', { x: 300, y: 220 });
    await pressOnCanvas(page, 'Escape');
    await expect(pad(page)).toBeVisible();

    // Clicking empty canvas clears the selection, and the pad is not a panel that
    // lingers — it belongs to the selection and goes with it (ux-spec §4).
    await page.getByTestId('modeler-canvas').click({ position: { x: 60, y: 60 } });
    await expect(pad(page)).toHaveCount(0);

    await page.locator('g[data-element-id^="EndEvent_"]').first().click();
    await expect(pad(page)).toBeVisible();
  });
});
