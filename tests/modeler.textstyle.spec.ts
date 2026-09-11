import { expect, test } from '@playwright/test';

import {
  addPaletteElement,
  exportDiagram,
  gotoModeler,
  pressOnCanvas,
  readDownloadText,
  setSelectedElementName,
} from './utils';

/**
 * Text styles, which the context pad's paintbrush sets alongside the element's own
 * colours — one menu for both (`popup/PopupMenus.tsx`, the `color-picker` id).
 *
 * The unit specs pin the model and the round trip (`packages/canvas/tests/canvas.unit.spec.ts`,
 * `tests/studyflow-yaml.unit.spec.ts`); what needs a browser is that a click restyles
 * the drawn text at once, that the menu stays up and shows what is set, and that the
 * file carries it on one `font` line.
 */
test('the style menu sets alignment, weight, slant and ink, and the file keeps them', async ({ page }) => {
  await gotoModeler(page);
  await addPaletteElement(page, 'Activities', 'Task', { x: 300, y: 220 });
  await pressOnCanvas(page, 'Escape');
  await setSelectedElementName(page, 'Read');

  const text = page.locator('g[data-element-id^="Task_"] text.sf-label').first();
  await page.getByTestId('context-pad-set-color').click();
  const menu = page.getByTestId('popup-menu');
  await expect(menu).toBeVisible();

  await menu.getByTestId('popup-menu-entry-bold').click();
  await expect(text).toHaveAttribute('font-weight', '700');
  await menu.getByTestId('popup-menu-entry-italic').click();
  await expect(text).toHaveAttribute('font-style', 'italic');
  await menu.getByTestId('popup-menu-entry-align-right').click();
  await expect(text).toHaveAttribute('text-anchor', 'end');
  await menu.getByTestId('popup-menu-entry-red-text-color').click();
  await expect(text).toHaveAttribute('fill', '#ac5a54');

  // The menu is still up, and its toggles report what the clicks wrote.
  await expect(menu.getByTestId('popup-menu-entry-bold')).toHaveAttribute('aria-pressed', 'true');
  await expect(menu.getByTestId('popup-menu-entry-align-right')).toHaveAttribute('aria-pressed', 'true');
  await expect(menu.getByTestId('popup-menu-entry-align-left')).toHaveAttribute('aria-pressed', 'false');

  // Clicking the alignment it already has puts it back to the element's own default.
  await menu.getByTestId('popup-menu-entry-align-right').click();
  await expect(text).toHaveAttribute('text-anchor', 'middle');

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  const yamlText = await readDownloadText(await exportDiagram(page, 'studyflow'));
  expect(yamlText).toMatch(/font: ['"]?bold italic #ac5a54['"]?/);
});
