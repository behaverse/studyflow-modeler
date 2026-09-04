import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  addPaletteElement,
  gotoModeler,
  labelEditor,
  pressOnCanvas,
} from './utils';

/**
 * Edge LABELS end to end in the real app — the `labels` recording of parity spec
 * addendum 3.
 *
 * The recording is one continuous gesture chain, and every link in it is a different
 * bit of machinery:
 *
 * 1. double-clicking an UNLABELED flow opens an editor above its midpoint, and
 *    committing text mints the caption (and its `bpmndi:BPMNLabel`);
 * 2. selecting the caption outlines it and offers four corner handles;
 * 3. dragging the caption moves the text itself, live;
 * 4. the caption travels alone — the flow underneath does not move — and the whole
 *    thing is ONE undo step.
 *
 * The unit specs pin each piece under jsdom; this proves they compose in a browser,
 * on a diagram built through the app's own palette and context pad.
 */

// The caption is an element of its own, addressed by its `_label` id.
const caption = (page: Page): Locator =>
  page.locator('svg.sf-canvas g.sf-external-label[data-element-id$="_label"]');
const handles = (page: Page): Locator => page.locator('svg.sf-canvas .sf-handle-visual');

async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element is not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('Edge labels', () => {
  test('naming a flow in place, then dragging its caption off the line', async ({ page }) => {
    await gotoModeler(page);

    // A task with an end event appended to it — the flow between them is the one
    // that gets named, exactly as the recording opens.
    await addPaletteElement(page, 'Activities', 'Task', { x: 380, y: 220 });
    await pressOnCanvas(page, 'Escape');
    await page.getByTestId('context-pad-append').click();
    await page.getByTestId('popup-menu-search').fill('end');
    await page.getByTestId('popup-menu-entry-create-End').click();
    await expect(page.locator('g[data-element-id^="EndEvent_"]')).toHaveCount(1);

    const flowGroup = page.locator('svg.sf-canvas g.sf-connection').first();
    const flowLine = flowGroup.locator('.sf-connection-line');
    await expect(caption(page), 'the flow starts out unnamed').toHaveCount(0);

    // 1 — double-click the flow itself and type a name.
    const onTheLine = await centreOf(flowLine);
    await page.mouse.dblclick(onTheLine.x, onTheLine.y);
    const editor = labelEditor(page);
    await expect(editor).toBeVisible();
    await editor.fill('Hello. this is a label');
    await page.keyboard.press('Enter');

    await expect(caption(page)).toHaveCount(1);
    await expect(caption(page)).toContainText('Hello. this is a label');

    // 2 — selecting the caption offers its four handles.
    const captionCentre = await centreOf(caption(page));
    await page.mouse.click(captionCentre.x, captionCentre.y);
    await expect(handles(page)).toHaveCount(4);

    // 3 — drag it clear of the line.
    const flowBefore = (await flowLine.boundingBox())!;
    await page.mouse.move(captionCentre.x, captionCentre.y);
    await page.mouse.down();
    // One intermediate frame so the gesture passes the drag threshold first.
    await page.mouse.move(captionCentre.x + 10, captionCentre.y - 12);
    await page.mouse.move(captionCentre.x + 40, captionCentre.y - 70);

    await expect(page.locator('svg.sf-canvas')).toHaveClass(/sf-drag-active/);

    await page.mouse.up();
    await expect(page.locator('svg.sf-canvas')).not.toHaveClass(/sf-drag-active/);

    // 4 — the caption moved, the flow did not.
    const captionAfter = await centreOf(caption(page));
    expect(captionAfter.y).toBeLessThan(captionCentre.y - 40);
    const flowAfter = (await flowLine.boundingBox())!;
    expect(Math.round(flowAfter.x)).toBe(Math.round(flowBefore.x));
    expect(Math.round(flowAfter.y)).toBe(Math.round(flowBefore.y));

    // One gesture, one undo step: the caption goes back, the name stays.
    await pressOnCanvas(page, 'ControlOrMeta+z');
    await expect(caption(page)).toContainText('Hello. this is a label');
    const undone = await centreOf(caption(page));
    expect(Math.abs(undone.y - captionCentre.y)).toBeLessThan(6);
  });
});
