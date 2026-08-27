import { expect, test, type Page } from '@playwright/test';

import {
  addPaletteElement,
  exportDiagram,
  gotoModeler,
  pressOnCanvas,
  readDownloadText,
} from './utils';

/**
 * The app-rendered popup menus and the context pad that opens two of them
 * (P6b §3A, §3B; parity spec addendum 4).
 *
 * This chrome is the app's own. bpmn-js used to render all three menus and the pad
 * as plugin chrome into `.djs-popup` / `.djs-context-pad`, which is why these specs
 * were skipped on that backend while it existed; they run unconditionally now that
 * the React popover and `contextPad/ContextPad.tsx` are the only implementations.
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
  test('the palette\'s more-elements button opens a searchable create menu that places what you pick', async ({ page }) => {
    await gotoModeler(page);

    await page.getByRole('button', { name: 'More BPMN elements...' }).click();
    await expect(popup(page)).toBeVisible();

    // Long enough to have earned a search field, whatever the editor asked for.
    const search = page.getByTestId('popup-menu-search');
    await expect(search).toBeVisible();
    await search.fill('service');

    const entry = page.getByTestId('popup-menu-entry-create-bpmn:ServiceTask');
    await expect(entry).toBeVisible();
    // Searching narrows: non-matching entries are gone, not merely dimmed.
    await expect(page.getByTestId('popup-menu-entry-create-bpmn:UserTask')).toHaveCount(0);

    await entry.click();
    // Picking arms a create gesture, exactly as a palette tile does; the next click places it.
    await expect(popup(page)).toHaveCount(0);
    await page.getByTestId('modeler-canvas').click({ position: { x: 340, y: 200 } });

    const bpmn = await readDownloadText(await exportDiagram(page, 'bpmn'));
    expect(bpmn).toContain('<bpmn2:serviceTask');
  });

  test('the context pad appends a successor and the sequence flow that reaches it', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Activities', 'Task', { x: 300, y: 220 });
    await expect(page.getByTestId('inspector-root')).toContainText('Task');

    const append = page.getByTestId('context-pad-append');
    await expect(append).toBeVisible();
    await append.click();
    await expect(popup(page)).toBeVisible();

    await page.getByTestId('popup-menu-search').fill('end');
    await page.getByTestId('popup-menu-entry-create-studyflow:EndEvent').click();
    await expect(popup(page)).toHaveCount(0);

    // Click-append places the shape itself — there is no second click on the canvas.
    await expect(page.locator('g[data-element-id^="EndEvent_"]')).toHaveCount(1);

    const bpmn = await readDownloadText(await exportDiagram(page, 'bpmn'));
    expect(bpmn).toContain('<bpmn2:endEvent');
    expect(bpmn).toMatch(/<bpmn2:sequenceFlow[^>]*sourceRef="Task_/);
    expect(bpmn).toMatch(/<bpmn2:sequenceFlow[^>]*targetRef="EndEvent_/);
    // Placed one gap to the right of its source, not on top of it.
    expect(shapeX(bpmn, 'EndEvent_')).toBeGreaterThan(shapeX(bpmn, 'Task_'));
  });

  test('the canvas\'s `a` shortcut opens the same append menu on the selection', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Activities', 'Task', { x: 300, y: 220 });
    // Creating a task opens its label editor; `a` belongs to the caption until it closes.
    await pressOnCanvas(page, 'Escape');

    await pressOnCanvas(page, 'a');
    await expect(popup(page)).toBeVisible();
    await expect(popup(page)).toContainText('Append element');
  });

  test('an end event offers no append, because nothing may follow it', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Events', 'End', { x: 300, y: 220 });
    await expect(page.getByTestId('context-pad')).toBeVisible();
    // The successor entries are gone entirely — the pad omits what the rules refuse,
    // as diagram-js's does. What remains is delete/colour plus the annotation, which
    // hangs off an end event by an association.
    await expect(page.getByTestId('context-pad-append')).toHaveCount(0);
    await expect(page.getByTestId('context-pad-append.end-event')).toHaveCount(0);
    await expect(page.getByTestId('context-pad-append.text-annotation')).toBeVisible();
    await expect(page.getByTestId('context-pad-delete')).toBeVisible();
  });

  test('the colour picker paints one element, and a whole multi-selection at once', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Activities', 'Task', { x: 260, y: 200 });
    await addPaletteElement(page, 'Activities', 'User', { x: 480, y: 200 });

    await page.getByTestId('context-pad-set-color').click();
    await expect(popup(page)).toBeVisible();
    await page.getByTestId('popup-menu-entry-blue-color').click();
    await expect(popup(page)).toHaveCount(0);

    let bpmn = await readDownloadText(await exportDiagram(page, 'bpmn'));
    // One shape, both colour vocabularies (`color:` and the legacy `bioc:`).
    expect(bpmn.match(/#dde8fa/gi)).toHaveLength(2);
    expect(bpmn.match(/#728cb9/gi)).toHaveLength(2);

    // Multi-select both, then repaint: the menu acts on the whole selection.
    await page.locator('g[data-element-id^="Task_"]').first().click();
    await page.locator('g[data-element-id^="UserTask_"]').first().click({ modifiers: ['Shift'] });

    await page.getByTestId('context-pad-set-color').click();
    await page.getByTestId('popup-menu-entry-green-color').click();
    await expect(popup(page)).toHaveCount(0);

    bpmn = await readDownloadText(await exportDiagram(page, 'bpmn'));
    expect(bpmn.match(/#d9e7d6/gi)).toHaveLength(4);
    expect(bpmn).not.toMatch(/#dde8fa/i);
  });
});
