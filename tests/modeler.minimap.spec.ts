import { expect, test, type Page } from '@playwright/test';

import { gotoModeler, runPaletteCommand } from './utils';

/**
 * The minimap, end to end: a second view of the study in the corner, where a press moves the canvas, and the command
 * palette hides and shows it. What it hears of the canvas's camera is pinned in
 * `packages/canvas/tests/canvas-viewport.unit.spec.ts`.
 */

/** The middle of the region the canvas shows, from its SVG's viewBox. */
async function viewCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId('modeler-canvas').locator('svg.sf-canvas').getAttribute('viewBox'))!.split(' ').map(Number);
  return { x: box[0] + box[2] / 2, y: box[1] + box[3] / 2 };
}

test('the minimap draws the study, which opens fitted clear of it; a press on it moves the canvas there, and the palette hides and shows it', async ({ page }) => {
  await gotoModeler(page);
  await runPaletteCommand(page, /^New/);
  // bot_ollama's model pool reaches the lower left corner, where the map stands.
  await page.getByTestId('example-bot_ollama').click();
  await expect(page.getByTestId('gallery-dialog')).toBeHidden();

  // It draws in a closed shadow root, out of the page's reach: what it draws is the canvas's own drawing.
  const minimap = page.getByTestId('minimap');
  await expect(minimap).toBeVisible();
  const map = (await minimap.boundingBox())!;

  // The canvas fits the study above the map: nothing it draws lies under it.
  const underMap = () => page.locator('svg.sf-canvas g[data-element-id]').evaluateAll((elements, m) => elements
    .filter((element) => {
      const b = element.getBoundingClientRect();
      return b.width > 0 && b.x < m.x + m.width && m.x < b.x + b.width && b.y < m.y + m.height && m.y < b.y + b.height;
    })
    .map((element) => element.getAttribute('data-element-id')), map);
  await expect.poll(underMap).toEqual([]);

  // The map fits the whole study, so its top edge is the study's top: a press there brings the canvas up.
  const before = await viewCentre(page);
  await page.mouse.click(map.x + map.width / 2, map.y + 6);
  expect((await viewCentre(page)).y).toBeLessThan(before.y);

  await runPaletteCommand(page, 'Hide Minimap');
  await expect(minimap).toHaveCount(0);
  await runPaletteCommand(page, 'Show Minimap');
  await expect(minimap).toBeVisible();
});
