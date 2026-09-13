import { expect, test, type Page } from '@playwright/test';

import {
  addPaletteElement,
  exportDiagram,
  gotoModeler,
  pressOnCanvas,
  readDownloadText,
} from './utils';

/**
 * The app-rendered popup menus: the create menu behind the palette's more-elements
 * button, the append menu the context pad and the `a` key open, and the style menu.
 * Which entries they list is `tests/popup-menu.unit.spec.ts`'s; where an appended
 * element lands is canvas-autoplace's.
 */

const popup = (page: Page) => page.getByTestId('popup-menu');

/** The `x` of the `bpmndi:BPMNShape` whose `bpmnElement` id starts with `prefix`. */
function shapeX(bpmn: string, prefix: string): number {
  const match = new RegExp(
    `<bpmndi:BPMNShape[^>]*bpmnElement="${prefix}[^"]*"[^>]*>\\s*<dc:Bounds[^>]*x="([-\\d.]+)"`,
  ).exec(bpmn);
  return match ? Number(match[1]) : NaN;
}

test.describe('App popup menus', () => {
  test('the create and append menus search, and place what you pick', async ({ page }) => {
    await gotoModeler(page);

    // The palette's more-elements button: a searchable create menu. Searching narrows the
    // list, and picking arms a create gesture, as a palette tile does: the next click places it.
    await page.getByRole('button', { name: 'BPMN elements...' }).click();
    await expect(popup(page)).toBeVisible();
    await page.getByTestId('popup-menu-search').fill('service');
    await expect(page.getByTestId('popup-menu-entry-create-User')).toHaveCount(0);
    await page.getByTestId('popup-menu-entry-create-Service').click();
    await expect(popup(page)).toHaveCount(0);
    await page.getByTestId('modeler-canvas').click({ position: { x: 340, y: 200 } });
    const service = page.locator('g[data-element-id^="ServiceTask_"]');
    await expect(service).toHaveCount(1);
    // A new task opens its label editor, which has the keys until it closes.
    await pressOnCanvas(page, 'Escape');

    // The canvas's `a` key opens the append menu on the selection.
    await pressOnCanvas(page, 'a');
    await expect(popup(page)).toContainText('Append element');
    await page.keyboard.press('Escape');
    await expect(popup(page)).toHaveCount(0);

    // So does the context pad's append entry, and a pick there appends at once: the
    // successor and the flow that reaches it, with no second click.
    await page.getByTestId('context-pad-append').click();
    await expect(popup(page)).toBeVisible();
    await page.getByTestId('popup-menu-search').fill('end');
    await page.getByTestId('popup-menu-entry-create-End').click();
    await expect(popup(page)).toHaveCount(0);
    await expect(page.locator('g[data-element-id^="EndEvent_"]')).toHaveCount(1);

    const bpmn = await readDownloadText(await exportDiagram(page, 'bpmn'));
    expect(bpmn).toMatch(/<bpmn2:sequenceFlow[^>]*sourceRef="ServiceTask_[^"]*"[^>]*targetRef="EndEvent_/);
    // Placed one gap to the right of its source, not on top of it.
    expect(shapeX(bpmn, 'EndEvent_')).toBeGreaterThan(shapeX(bpmn, 'ServiceTask_'));
  });

  test('the style menu sets colours and text styles on one element, and paints a multi-selection at once', async ({ page }) => {
    await gotoModeler(page);
    await addPaletteElement(page, 'Activities', 'Task', { x: 260, y: 200 });
    await page.keyboard.type('Read');
    await pressOnCanvas(page, 'Escape');
    await addPaletteElement(page, 'Activities', 'User', { x: 480, y: 200 });
    await pressOnCanvas(page, 'Escape');
    const task = page.locator('g[data-element-id^="Task_"]').first();
    const body = (prefix: string) => page.locator(`g[data-element-id^="${prefix}"] rect:not(.sf-outline)`).first();

    await task.click();
    await page.getByTestId('context-pad-set-color').click();
    const menu = popup(page);
    await expect(menu).toBeVisible();

    // A swatch paints the element, and the menu stays up and reports what is set: colour and
    // text styles are set in one sitting, and a reopened menu shows the element's own.
    await menu.getByTestId('popup-menu-entry-blue-color').click();
    await expect(body('Task_')).toHaveAttribute('fill', '#dde8fa');
    await expect(menu.getByTestId('popup-menu-entry-blue-color')).toHaveAttribute('aria-pressed', 'true');
    await expect(menu.getByTestId('popup-menu-entry-default-color')).toHaveAttribute('aria-pressed', 'false');

    // Each text style restyles the drawn text at once.
    const text = task.locator('text.sf-label').first();
    await menu.getByTestId('popup-menu-entry-bold').click();
    await expect(text).toHaveAttribute('font-weight', '700');
    await menu.getByTestId('popup-menu-entry-italic').click();
    await expect(text).toHaveAttribute('font-style', 'italic');
    await menu.getByTestId('popup-menu-entry-align-right').click();
    await expect(text).toHaveAttribute('text-anchor', 'end');
    await menu.getByTestId('popup-menu-entry-red-text-color').click();
    await expect(text).toHaveAttribute('fill', '#ac5a54');
    await expect(menu.getByTestId('popup-menu-entry-bold')).toHaveAttribute('aria-pressed', 'true');
    await expect(menu.getByTestId('popup-menu-entry-align-right')).toHaveAttribute('aria-pressed', 'true');
    await expect(menu.getByTestId('popup-menu-entry-align-left')).toHaveAttribute('aria-pressed', 'false');
    // Clicking the alignment it already has puts back the element's own default.
    await menu.getByTestId('popup-menu-entry-align-right').click();
    await expect(text).toHaveAttribute('text-anchor', 'middle');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // The file carries the text style on one `font` line.
    const yamlText = await readDownloadText(await exportDiagram(page, 'studyflow'));
    expect(yamlText).toMatch(/font: ['"]?bold italic #ac5a54['"]?/);

    // Multi-select both, then repaint: the menu acts on the whole selection.
    await task.click();
    await page.locator('g[data-element-id^="UserTask_"]').first().click({ modifiers: ['Shift'] });
    await page.getByTestId('context-pad-set-color').click();
    await page.getByTestId('popup-menu-entry-green-color').click();
    await page.keyboard.press('Escape');
    await expect(body('Task_')).toHaveAttribute('fill', '#d9e7d6');
    await expect(body('UserTask_')).toHaveAttribute('fill', '#d9e7d6');
  });
});
