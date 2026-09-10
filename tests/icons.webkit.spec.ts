import { expect, test } from '@playwright/test';

import { gotoModeler, runPaletteCommand } from './utils';

/**
 * WebKit will not render a CSS mask inside an SVG `<foreignObject>` — the box lays out, a plain
 * background paints, and the glyph never appears. Iconify's classes paint with exactly that mask,
 * so every icon on the canvas vanished in Safari while Chromium showed them all.
 *
 * The canvas now reads every class's glyph out of the stylesheet and draws it as a real nested
 * `<svg>` (`render/icons.ts`), which WebKit has no trouble with; only a class the stylesheet does
 * not know is left as a `foreignObject`, and that one paints nothing anywhere. This test holds that
 * line in the engine that cares.
 */
test('every canvas icon paints something in WebKit — no masked glyph', async ({ page }) => {
  await gotoModeler(page);
  await runPaletteCommand(page, 'New...');
  await page.getByTestId('example-cognitive_battery').click();
  await expect(page.locator('g[data-element-id="Task_NBack"]')).toBeVisible();

  const icons = await page.evaluate(() => ({
    // Resolved glyphs: real SVG bodies drawn straight into the scene.
    inline: document.querySelectorAll('svg.sf-icon').length,
    // Unresolved ones: still a class in a foreignObject, and the mask is what breaks here.
    css: [...document.querySelectorAll('foreignObject.icon-container div[data-icon-class]')].map((div) => {
      const style = getComputedStyle(div);
      return {
        iconClass: div.getAttribute('data-icon-class'),
        masked: style.maskImage !== 'none' && style.maskImage !== '',
        painted: style.backgroundImage !== 'none' && style.backgroundImage !== '',
      };
    }),
  }));

  expect(icons.inline, 'the battery draws several icons').toBeGreaterThan(3);
  expect(icons.css).toEqual([]);
});
