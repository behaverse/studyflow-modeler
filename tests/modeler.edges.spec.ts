import { expect, test, type Locator, type Page } from '@playwright/test';

import { addPaletteElement, gotoModeler, pressOnCanvas } from './utils';

/**
 * Connect and reconnect feedback, driven by a real pointer. The canvas specs pin what a
 * drop does; this pins what the user SEES while the pointer is down: the cursor under
 * it, whether the shape it is over says it will take the drop, and whether a refused
 * drag reads as refused. So it reads computed styles, not only the markers the canvas
 * sets (`data-connect-status`, `sf-drop-ok`, `sf-drop-not-ok`).
 */

const canvasSvg = (page: Page): Locator => page.getByTestId('modeler-canvas').locator('svg.sf-canvas');

/** A computed style of an element, as the browser paints it. */
function styleOf(locator: Locator, property: 'cursor' | 'fill' | 'backgroundColor'): Promise<string> {
  // (tests are typechecked without the DOM lib, hence the `any`)
  return locator.evaluate((el: any, name) => el.ownerDocument.defaultView.getComputedStyle(el)[name], property);
}

test('a drag shows its verdict under the pointer: a target that takes it, empty space, a target that refuses it', async ({ page }) => {
  await gotoModeler(page);
  await addPaletteElement(page, 'Activities', 'Task', { x: 300, y: 220 });
  await pressOnCanvas(page, 'Escape');
  await page.getByTestId('context-pad-append.end-event').click();
  await addPaletteElement(page, 'Activities', 'User', { x: 700, y: 400 });
  await pressOnCanvas(page, 'Escape');
  const task = page.locator('g[data-element-id^="Task_"]').first();
  await task.click();
  await page.getByTestId('context-pad-append.text-annotation').click();
  const note = page.locator('g[data-element-id^="TextAnnotation_"]').first();
  await expect(note).toHaveCount(1);

  // A connect drag over a shape the rules accept: the shape fills with the drop tint and
  // the pointer wears the crosshair.
  await task.click();
  await page.getByTestId('context-pad-connect').hover();
  await page.mouse.down();
  const userTask = page.locator('g[data-element-id^="UserTask_"]').first();
  const over = (await userTask.boundingBox())!;
  await page.mouse.move(over.x + over.width / 2, over.y + over.height / 2, { steps: 12 });
  await expect(canvasSvg(page)).toHaveAttribute('data-connect-status', 'ok');
  await expect(userTask).toHaveClass(/sf-drop-ok/);
  expect(await styleOf(userTask.locator('rect:not(.sf-outline)').first(), 'fill')).not.toBe('none');
  expect(await styleOf(userTask, 'cursor')).toBe('crosshair');

  // Over empty space it wears ∅ and washes the whole canvas pale red, which is what makes
  // a refused drag readable where there is no shape to tint.
  await page.mouse.move(700, 620, { steps: 12 });
  await expect(canvasSvg(page)).toHaveAttribute('data-connect-status', 'pending');
  expect(await styleOf(canvasSvg(page), 'cursor')).toBe('not-allowed');
  expect(await styleOf(canvasSvg(page), 'backgroundColor')).not.toBe('rgba(0, 0, 0, 0)');
  await page.mouse.up();
  // Nothing survives the gesture.
  await expect(page.locator('.sf-drop-ok, .sf-drop-not-ok')).toHaveCount(0);
  await expect(canvasSvg(page)).not.toHaveAttribute('data-connect-status', /.*/);

  // The flow's end dragged onto a shape the rules refuse (a text annotation is never a
  // sequence flow's target): the shape says so, the pointer wears ∅, and the drop writes nothing.
  const line = page.locator('g[data-element-id^="SequenceFlow_"], g[data-element-id^="Flow_"]').first()
    .locator('.sf-connection-line');
  const points = (await line.getAttribute('data-waypoints'))!;
  const [lastX, lastY] = points.split(' ').pop()!.split(',').map(Number);
  const end = await canvasSvg(page).evaluate((el: any, p: { x: number; y: number }) => {
    const svg = el as SVGSVGElement;
    const point = svg.createSVGPoint();
    point.x = p.x;
    point.y = p.y;
    const at = point.matrixTransform(svg.getScreenCTM()!);
    return { x: at.x, y: at.y };
  }, { x: lastX, y: lastY });
  // Clear the selection, so no pad sits over the flow; select the flow by pressing its body
  // a little before its end, then grab the end.
  await page.getByTestId('modeler-canvas').click({ position: { x: 60, y: 60 } });
  await page.mouse.click(end.x - 12, end.y);
  await page.mouse.move(end.x, end.y);
  await page.mouse.down();
  const onto = (await note.boundingBox())!;
  await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 12 });
  await expect(canvasSvg(page)).toHaveAttribute('data-connect-status', 'rejected');
  await expect(note).toHaveClass(/sf-drop-not-ok/);
  expect(await styleOf(note, 'cursor')).toBe('not-allowed');
  await page.mouse.up();
  await expect(line).toHaveAttribute('data-waypoints', points);
  await expect(canvasSvg(page)).not.toHaveAttribute('data-connect-status', /.*/);
});
