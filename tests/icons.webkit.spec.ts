import { expect, test } from '@playwright/test';

import { gotoModeler, runPaletteCommand } from './utils';

/**
 * Canvas icons live in an SVG `<foreignObject>`, and WebKit will not render a CSS mask in one —
 * the box lays out, a plain background paints, and the glyph never appears. Iconify's classes
 * paint with exactly that mask, so every icon on the canvas vanished in Safari while Chromium
 * showed them all. `drawIcon` repaints them as background images instead; these tests hold that
 * line, in the engine that cares.
 */
test.describe('canvas icons in WebKit', () => {
  test('no canvas icon is painted with a mask', async ({ page }) => {
    await gotoModeler(page);
    await runPaletteCommand(page, 'New...');
    await page.getByTestId('example-cognitive_battery').click();
    await expect(page.locator('g[data-element-id="Task_NBack"]')).toBeVisible();

    const icons = await page.evaluate(() =>
      [...document.querySelectorAll('foreignObject.icon-container div[data-icon-class]')].map((div) => {
        const style = getComputedStyle(div);
        return {
          iconClass: div.getAttribute('data-icon-class'),
          masked: style.maskImage !== 'none' && style.maskImage !== '',
          painted: style.backgroundImage !== 'none' && style.backgroundImage !== '',
        };
      }));

    expect(icons.length, 'the battery draws several icons').toBeGreaterThan(3);
    expect(icons.filter((icon) => icon.masked)).toEqual([]);
    expect(icons.filter((icon) => !icon.painted)).toEqual([]);
  });

  test('an icon carries the element colour, not the mask source black', async ({ page }) => {
    await gotoModeler(page);
    await runPaletteCommand(page, 'New...');
    await page.getByTestId('example-cognitive_battery').click();
    await expect(page.locator('g[data-element-id="Task_NBack"]')).toBeVisible();

    const icon = await page.evaluate(() => {
      const div = document.querySelector('g[data-element-id="Task_NBack"] foreignObject div[data-icon-class]')!;
      return {
        color: div.getAttribute('data-icon-color'),
        source: decodeURIComponent(getComputedStyle(div).backgroundImage),
      };
    });

    expect(icon.color).toMatch(/^#[0-9a-f]{6}$/i);
    // Recoloured in the data URI, since a background image cannot inherit `currentColor`.
    expect(icon.source).toContain(icon.color);
    expect(icon.source).not.toContain("fill='black'");
  });
});
