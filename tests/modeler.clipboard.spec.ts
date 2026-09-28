import { expect, test, type Page } from '@playwright/test';

import { addPaletteElement, gotoModeler, pressOnCanvas } from './utils';

/**
 * Copy and paste, end to end: the canvas answers the browser's clipboard events with `.studyflow.yaml` text. What a
 * copy holds and what a paste makes is pinned in `packages/canvas/tests/study.unit.spec.ts`. The events are fired
 * here with a clipboard of their own, as the browser fires them for its shortcuts, so a run leaves the machine's
 * clipboard as it was.
 */

/** Fire a clipboard event of `type` at the canvas, its clipboard holding `text`; what the clipboard holds after. */
async function clipboardEvent(page: Page, type: 'copy' | 'paste', text = ''): Promise<string> {
  return page.getByTestId('modeler-canvas').locator('svg[tabindex]').evaluate((svg, [kind, held]) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', held);
    svg.dispatchEvent(new ClipboardEvent(kind, { clipboardData, bubbles: true, cancelable: true }));
    return clipboardData.getData('text/plain');
  }, [type, text] as const);
}

test('a copied task pastes under the pointer, selected, and a duplicate lands beside it', async ({ page }) => {
  await gotoModeler(page);
  await addPaletteElement(page, 'Activities', 'Task', { x: 300, y: 220 });
  await pressOnCanvas(page, 'Escape');
  const tasks = page.locator('g[data-element-id^="Task_"]');
  const selected = page.locator('g[data-element-id^="Task_"][class*="selected"]');
  await tasks.first().click();

  const yaml = await clipboardEvent(page, 'copy');
  expect(yaml).toContain('type: Task');

  const canvas = (await page.getByTestId('modeler-canvas').boundingBox())!;
  const pointer = { x: canvas.x + 600, y: canvas.y + 400 };
  await page.mouse.move(pointer.x, pointer.y);
  await clipboardEvent(page, 'paste', yaml);
  await expect(tasks).toHaveCount(2);
  await expect(selected).toHaveCount(1);
  const box = (await selected.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - pointer.x)).toBeLessThan(10);
  expect(Math.abs(box.y + box.height / 2 - pointer.y)).toBeLessThan(10);

  await pressOnCanvas(page, 'ControlOrMeta+d');
  await expect(tasks).toHaveCount(3);
  await pressOnCanvas(page, 'ControlOrMeta+z');
  await expect(tasks).toHaveCount(2);
});
