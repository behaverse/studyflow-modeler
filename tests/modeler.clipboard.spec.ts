import type { Page } from '@playwright/test';
import { expect, test } from './e2e';

import { extractPastedImagesFromPng, extractStudyflowFromPng } from '@core/document/png';

import { addPaletteElement, diagramTitle, exportDiagram, gotoModeler, labelEditor, pressOnCanvas, readDownload, readDownloadText } from './utils';

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

/** A clipboard holding only a PNG, made in the page as a screenshot would be, fired as a paste at the canvas. */
async function pastePng(page: Page, width: number, height: number): Promise<void> {
  await page.getByTestId('modeler-canvas').locator('svg[tabindex]').evaluate(async (svg, size) => {
    const canvas = Object.assign(document.createElement('canvas'), size);
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#c0392b';
    context.fillRect(0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((made) => resolve(made!), 'image/png'));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    svg.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, { width, height });
}

test('a pasted PNG shows, is saved in a .studyflow.png, opens again from it, and stays out of every other file', async ({ page }) => {
  await gotoModeler(page);
  const image = page.locator('[data-element-id] image');

  await pastePng(page, 320, 160);
  await expect(image).toHaveCount(1);
  await expect(image).toHaveAttribute('href', /^data:image\/png;base64,/);
  await expect(page.locator('[data-element-id][class*="selected"] image'), 'selected, as a paste is').toHaveCount(1);
  await expect(page.getByText('Only a .studyflow.png keeps a pasted image'), 'the file being worked on would not keep it').toBeVisible();

  // Its text is an id, so a double click opens no editor on it.
  await image.dblclick();
  await expect(labelEditor(page)).toHaveCount(0);

  // The browser's copy holds text alone, and would come back linked to the file without the image.
  await expect.poll(() => page.evaluate(() => Object.values(localStorage).some((value) => value.includes('<bpmn:definitions')))).toBe(false);

  const yaml = await readDownloadText(await exportDiagram(page, 'studyflow'));
  expect(yaml).not.toContain('image/png');
  await expect(page.getByText('leaves out the image pasted on the canvas')).toBeVisible();
  expect(await readDownloadText(await exportDiagram(page, 'svg'))).not.toContain('<image');

  const png = await readDownload(await exportDiagram(page, 'png'));
  expect(extractStudyflowFromPng(png)).toContain('textFormat: image/png');
  expect(extractPastedImagesFromPng(png).size).toBe(1);
  // In the picture itself, as a reader who never opens the modeler sees it.
  const reddened = await page.evaluate(async (url) => {
    const picture = new Image();
    picture.src = url;
    await picture.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: picture.width, height: picture.height });
    const context = canvas.getContext('2d')!;
    context.drawImage(picture, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] === 0xc0 && data[i + 1] === 0x39 && data[i + 2] === 0x2b) count += 1;
    return count;
  }, `data:image/png;base64,${png.toString('base64')}`);
  expect(reddened, 'all 320 by 160 pixels of it').toBeGreaterThan(320 * 160 * 0.9);

  // Back from a file that has it, and the same again after another save: the bytes, not the last drawing of them.
  await page.getByTestId('open-file-input').setInputFiles({ name: 'with-image.studyflow.png', mimeType: 'image/png', buffer: png });
  await expect(diagramTitle(page)).toHaveText('with-image');
  await expect(image).toHaveCount(1);
  await expect(image).toHaveAttribute('href', /^data:image\/png;base64,/);
  const again = await readDownload(await exportDiagram(page, 'png'));
  expect(extractPastedImagesFromPng(again)).toEqual(extractPastedImagesFromPng(png));

  // Opening a file that holds none leaves none behind.
  await page.getByTestId('open-file-input').setInputFiles({ name: 'plain.studyflow.yaml', mimeType: 'text/yaml', buffer: Buffer.from(yaml, 'utf8') });
  await expect(diagramTitle(page)).toHaveText('plain');
  await expect(image).toHaveCount(0);
});
