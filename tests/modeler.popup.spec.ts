import { expect, test, type Page } from '@playwright/test';

import { ELEMENT_COLORS } from '@modeler/shape/colors';

import { addPaletteElement, gotoModeler, pressOnCanvas } from './utils';

/**
 * The app-rendered popup menus: the create menu behind the palette's more-elements
 * button, the append menu the context pad and the `a` key open, the replace menu behind
 * the pad's wrench, and the style menu. Which entries they list is
 * `tests/popup-menu.unit.spec.ts`'s; where an appended element lands is canvas-autoplace's,
 * what a retype writes canvas-replace's, and what a style writes canvas.unit's.
 */

const popup = (page: Page) => page.getByTestId('popup-menu');

/** The swatch's paint as an attribute matcher: the canvas may spell the hex in either case. */
const swatch = (label: string, half: 'fill' | 'stroke'): RegExp => new RegExp(`^${ELEMENT_COLORS.find((c) => c.label === label)![half]!}$`, 'i');

test.describe('App popup menus', () => {
  test('the create and append menus search and place what you pick, and the replace menu retypes as one undo step', async ({ page }) => {
    await gotoModeler(page);

    // The palette's more-elements button: a searchable create menu. Searching narrows the
    // list, and picking arms a create gesture, as a palette tile does: the next click places it.
    await page.getByRole('button', { name: /^BPMN elements/ }).click();
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
    await expect(popup(page)).toContainText(/append/i);
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

    // The wrench opens a searchable menu too, and a pick retypes the element where it stands:
    // one edit, so one undo puts it back.
    await service.click();
    await page.getByTestId('context-pad-replace').click();
    await expect(popup(page)).toBeVisible();
    await page.getByTestId('popup-menu-entry-create-User').click();
    await expect(service).toHaveCount(0);
    await expect(page.locator('g[data-element-id^="UserTask_"]')).toHaveCount(1);
    await pressOnCanvas(page, 'ControlOrMeta+z');
    await expect(service).toHaveCount(1);
    await expect(page.locator('g[data-element-id^="UserTask_"]')).toHaveCount(0);
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
    await expect(body('Task_')).toHaveAttribute('fill', swatch('Blue', 'fill'));
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
    await expect(text).toHaveAttribute('fill', swatch('Red', 'stroke'));
    await expect(menu.getByTestId('popup-menu-entry-bold')).toHaveAttribute('aria-pressed', 'true');
    await expect(menu.getByTestId('popup-menu-entry-align-right')).toHaveAttribute('aria-pressed', 'true');
    await expect(menu.getByTestId('popup-menu-entry-align-left')).toHaveAttribute('aria-pressed', 'false');
    // Clicking the alignment it already has puts back the element's own default.
    await menu.getByTestId('popup-menu-entry-align-right').click();
    await expect(text).toHaveAttribute('text-anchor', 'middle');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // Multi-select both, then repaint: the menu acts on the whole selection.
    await task.click();
    await page.locator('g[data-element-id^="UserTask_"]').first().click({ modifiers: ['Shift'] });
    await page.getByTestId('context-pad-set-color').click();
    await page.getByTestId('popup-menu-entry-green-color').click();
    await page.keyboard.press('Escape');
    await expect(body('Task_')).toHaveAttribute('fill', swatch('Green', 'fill'));
    await expect(body('UserTask_')).toHaveAttribute('fill', swatch('Green', 'fill'));
  });
});
