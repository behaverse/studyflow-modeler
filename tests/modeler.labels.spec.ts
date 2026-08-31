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
 * 2. selecting the caption draws a blue DASHED leader back to the flow, plus eight
 *    inert chips around the box — the user's specific callout (`labels/frame_08`);
 * 3. dragging the caption makes the TEXT ITSELF the blue ghost, leaves the original
 *    faint behind it, and keeps the leader up throughout (`labels/frame_05`);
 * 4. the caption travels alone — the flow underneath does not move — and the whole
 *    thing is ONE undo step.
 *
 * The unit specs pin each piece under jsdom; this proves they compose in a browser,
 * on a diagram built through the app's own palette and context pad.
 */

// The LIVE caption, not the frozen 0.3-opacity copy a drag parks in the overlays
// layer: the clone wears the same class, and its `data-element-id` is stripped
// precisely so nothing can address it as the element it copies.
const caption = (page: Page): Locator =>
  page.locator('svg.sf-canvas g.sf-external-label[data-element-id$="_label"]');
const leader = (page: Page): Locator => page.locator('svg.sf-canvas .sf-label-leader');
const chips = (page: Page): Locator => page.locator('svg.sf-canvas .sf-resizer');

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
    await page.getByTestId('popup-menu-entry-create-studyflow:EndEvent').click();
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

    // 2 — selecting the caption draws the leader and the chips.
    const captionCentre = await centreOf(caption(page));
    await page.mouse.click(captionCentre.x, captionCentre.y);
    await expect(leader(page)).toHaveCount(1);
    await expect(chips(page)).toHaveCount(8);

    // 3 — drag it clear of the line.
    const flowBefore = (await flowLine.boundingBox())!;
    await page.mouse.move(captionCentre.x, captionCentre.y);
    await page.mouse.down();
    // One intermediate frame so the gesture passes the drag threshold first.
    await page.mouse.move(captionCentre.x + 10, captionCentre.y - 12);
    await page.mouse.move(captionCentre.x + 40, captionCentre.y - 70);

    await expect(caption(page)).toHaveClass(/sf-dragger/);
    await expect(page.locator('svg.sf-canvas .sf-drag-originals')).toHaveCount(1);
    // The association stays visible for the whole gesture — that is when it matters.
    await expect(leader(page)).toHaveCount(1);
    await expect(chips(page), 'the chips step aside for the gesture').toHaveCount(0);

    await page.mouse.up();
    await expect(caption(page)).not.toHaveClass(/sf-dragger/);

    // 4 — the caption moved, the flow did not.
    const captionAfter = await centreOf(caption(page));
    expect(captionAfter.y).toBeLessThan(captionCentre.y - 40);
    const flowAfter = (await flowLine.boundingBox())!;
    expect(Math.round(flowAfter.x)).toBe(Math.round(flowBefore.x));
    expect(Math.round(flowAfter.y)).toBe(Math.round(flowBefore.y));
    // …and the leader is longer than it was, still tying the two together.
    await expect(leader(page)).toHaveCount(1);

    // One gesture, one undo step: the caption goes back, the name stays.
    await pressOnCanvas(page, 'ControlOrMeta+z');
    await expect(caption(page)).toContainText('Hello. this is a label');
    const undone = await centreOf(caption(page));
    expect(Math.abs(undone.y - captionCentre.y)).toBeLessThan(6);
  });
});
