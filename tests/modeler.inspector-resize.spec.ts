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
  test('the handle widens the panel by pointer or keyboard, the width outlives a reload, and a double-click resets it', async ({ page }) => {
    await gotoModeler(page);
    const panel = page.getByTestId('inspector-root');
    const handle = page.getByTestId('inspector-resize-handle');
    const before = (await panel.boundingBox())!;
    const initial = await panelWidth(page);

    await dragHandle(page, -140);
    const widened = (await panel.boundingBox())!;
    expect(Math.round(widened.width)).toBeGreaterThan(initial + 100);
    // It grows leftward, horizontally only: its top and its right edge stay where they were.
    expect(widened.y).toBe(before.y);
    expect(widened.x + widened.width).toBe(before.x + before.width);

    await page.reload();
    await expect(page.getByTestId('modeler-ready')).toBeAttached({ timeout: 30_000 });
    expect(await panelWidth(page)).toBe(Math.round(widened.width));

    await handle.dblclick();
    expect(await panelWidth(page)).toBe(initial);

    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await panelWidth(page)).toBe(initial + 48);
    await page.keyboard.press('Home');
    expect(await panelWidth(page)).toBe(initial);
  });
});
