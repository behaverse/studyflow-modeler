import { expect, test, type Page } from '@playwright/test';

import { gotoModeler } from './utils';

/** The inspector's left edge is a resize handle, and the width it is left at persists. */

async function panelWidth(page: Page): Promise<number> {
  const box = await page.getByTestId('inspector-root').boundingBox();
  if (!box) throw new Error('The inspector is not visible.');
  return Math.round(box.width);
}

async function dragHandle(page: Page, dx: number): Promise<void> {
  const handle = page.getByTestId('inspector-resize-handle');
  const box = await handle.boundingBox();
  if (!box) throw new Error('The resize handle is not visible.');

  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 8 });
  await page.mouse.up();
}

test.describe('Inspector resize', () => {
  test('drags wider, and keeps that width across a reload', async ({ page }) => {
    await gotoModeler(page);

    const initial = await panelWidth(page);
    await dragHandle(page, -140);

    const widened = await panelWidth(page);
    expect(widened).toBeGreaterThan(initial + 100);

    await page.reload();
    await expect(page.getByTestId('modeler-ready')).toBeAttached({ timeout: 30_000 });
    expect(await panelWidth(page)).toBe(widened);

    await page.getByTestId('inspector-resize-handle').dblclick();
    expect(await panelWidth(page)).toBe(initial);
  });

  test('resizes horizontally only, within bounds, and from the keyboard', async ({ page }) => {
    await gotoModeler(page);
    const before = await page.getByTestId('inspector-root').boundingBox();

    await dragHandle(page, -4000);
    const wide = await page.getByTestId('inspector-root').boundingBox();
    expect(wide!.width).toBeLessThanOrEqual(page.viewportSize()!.width / 2);
    expect(wide!.y).toBe(before!.y);
    expect(wide!.x + wide!.width).toBe(before!.x + before!.width);

    await dragHandle(page, 4000);
    expect(await panelWidth(page)).toBe(240);

    await page.getByTestId('inspector-resize-handle').focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await panelWidth(page)).toBe(240 + 48);
    await page.keyboard.press('Home');
    expect(await panelWidth(page)).toBe(288);
  });
});
