import { expect, test, type Locator, type Page } from '@playwright/test';

import { addPaletteElement, gotoModeler, pressOnCanvas } from './utils';

/**
 * Connect / reconnect FEEDBACK, driven by a real pointer (parity spec §1 and §5,
 * addendum 4 §2; reference frames `edge-videos/v2/frame_02` and
 * `edge-videos/edgemake/frame_02`).
 *
 * The unit specs pin the state machine and the markers it sets; what only a browser
 * can answer is what the user actually SEES while the pointer is down — which cursor
 * is under it, whether the shape it is over says it will take the drop, and whether
 * a refused drag reads as refused. The invalid half of that had no coverage at all
 * in either direction, which is how a spec requirement can quietly go missing.
 */

const canvasSvg = (page: Page): Locator => page.getByTestId('modeler-canvas').locator('svg.sf-canvas');

/** Computed CSS `cursor` on an element, i.e. what the pointer is actually wearing. */
function cursorOf(locator: Locator): Promise<string> {
  // (tests are typechecked without the DOM lib, hence the `any`)
  return locator.evaluate((el: any) => el.ownerDocument.defaultView.getComputedStyle(el).cursor);
}

/** A task with an end event appended to it — one shape, one flow, one target. */
async function taskWithFlow(page: Page): Promise<void> {
  await gotoModeler(page);
  await addPaletteElement(page, 'Activities', 'Task', { x: 320, y: 220 });
  await pressOnCanvas(page, 'Escape');
  await page.getByTestId('context-pad-append.end-event').click();
  await expect(page.locator('g[data-element-id^="EndEvent_"]')).toHaveCount(1);
}

test.describe('Connect and reconnect feedback', () => {
  test('a valid connect drag tints the target and lets the cursor go', async ({ page }) => {
    // `edgemake/frame_02`: the shape under the pointer fills light-grey for as long
    // as the drag hangs over it. Before this the ghost line turning solid was the
    // only signal, and it happens on the far side of the canvas from the cursor.
    await gotoModeler(page);
    await addPaletteElement(page, 'Activities', 'Task', { x: 300, y: 220 });
    await pressOnCanvas(page, 'Escape');
    await addPaletteElement(page, 'Activities', 'User', { x: 700, y: 400 });
    await pressOnCanvas(page, 'Escape');

    await page.locator('g[data-element-id^="Task_"]').first().click();
    const connect = page.getByTestId('context-pad-connect');
    await connect.hover();
    const target = page.locator('g[data-element-id^="UserTask_"]').first();
    const to = (await target.boundingBox())!;

    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });

    await expect(canvasSvg(page)).toHaveAttribute('data-connect-status', 'ok');
    await expect(target).toHaveClass(/sf-drop-ok/);
    // Painted, not merely classed: the body under the mark really is the drop-ok fill.
    const body = target.locator('rect:not(.sf-outline)').first();
    expect(await body.evaluate((el: any) => el.ownerDocument.defaultView.getComputedStyle(el).fill))
      .not.toBe('none');
    expect(await cursorOf(target)).toBe('crosshair');

    await page.mouse.up();
    // Nothing survives the gesture.
    await expect(page.locator('.sf-drop-ok, .sf-drop-not-ok')).toHaveCount(0);
    await expect(canvasSvg(page)).not.toHaveAttribute('data-connect-status', /.*/);
  });

  test('a connect drag over empty space wears the ∅ cursor and washes the canvas', async ({ page }) => {
    // `v2/frame_02`: a straight dotted rubber band, a ∅ under the cursor and the
    // whole surface tinted pale red — which is what makes a refused drag readable
    // when the pointer is out where there is no shape to tint.
    await gotoModeler(page);
    await addPaletteElement(page, 'Activities', 'Task', { x: 320, y: 220 });
    await pressOnCanvas(page, 'Escape');

    await page.locator('g[data-element-id^="Task_"]').first().click();
    await page.getByTestId('context-pad-connect').hover();
    await page.mouse.down();
    await page.mouse.move(700, 620, { steps: 12 });

    await expect(canvasSvg(page)).toHaveAttribute('data-connect-status', 'pending');
    expect(await cursorOf(canvasSvg(page))).toBe('not-allowed');
    expect(await canvasSvg(page).evaluate(
      (el: any) => el.ownerDocument.defaultView.getComputedStyle(el).backgroundColor,
    )).not.toBe('rgba(0, 0, 0, 0)');

    await page.mouse.up();
    await expect(canvasSvg(page)).not.toHaveAttribute('data-connect-status', /.*/);
  });

  test('dragging an endpoint onto a target the rules refuse shows the no-drop cursor', async ({ page }) => {
    // Parity spec §1 requires this and nothing exercised it: only the VALID drop was
    // ever driven. A text annotation is never a sequence flow's target.
    await taskWithFlow(page);
    await page.locator('g[data-element-id^="Task_"]').first().click();
    await page.getByTestId('context-pad-append.text-annotation').click();
    const note = page.locator('g[data-element-id^="TextAnnotation_"]').first();
    await expect(note).toHaveCount(1);

    // Select the flow, then drag its LAST waypoint (the endpoint handle).
    const flow = page.locator('g[data-element-id^="SequenceFlow_"], g[data-element-id^="Flow_"]').first();
    const line = flow.locator('.sf-connection-line');
    const points = await line.getAttribute('data-waypoints');
    const [lastX, lastY] = points!.split(' ').pop()!.split(',').map(Number);
    const screen = await canvasSvg(page).evaluate((el: any, p: { x: number; y: number }) => {
      const svg = el as SVGSVGElement;
      const point = svg.createSVGPoint();
      point.x = p.x;
      point.y = p.y;
      const at = point.matrixTransform(svg.getScreenCTM()!);
      return { x: at.x, y: at.y };
    }, { x: lastX, y: lastY });

    await page.mouse.click(screen.x - 12, screen.y);
    await page.mouse.move(screen.x, screen.y);
    await page.mouse.down();
    const to = (await note.boundingBox())!;
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });

    await expect(canvasSvg(page)).toHaveAttribute('data-connect-status', 'rejected');
    await expect(note).toHaveClass(/sf-drop-not-ok/);
    expect(await cursorOf(note)).toBe('not-allowed');

    await page.mouse.up();
    // The drop wrote nothing: the flow still ends where it did.
    await expect(line).toHaveAttribute('data-waypoints', points!);
    await expect(canvasSvg(page)).not.toHaveAttribute('data-connect-status', /.*/);
  });
});

