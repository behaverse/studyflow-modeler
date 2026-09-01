import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
  addPaletteElement,
  exportDiagram,
  expectEditorText,
  gotoModeler,
  labelEditor,
  pressOnCanvas,
  readDownloadText,
} from './utils';

/**
 * Sub-process drill-down AND in-place expand, end to end
 * (`scratchpad/subprocess-drilldown-spec.md`, frames `edge-videos/sub/*`; the
 * uniformity report of 2026-08-27).
 *
 * `sklearn_pipeline` is the fixture because it ships BOTH shapes of the feature at
 * once: `select_model` is drawn collapsed and owns its own `bpmndi:BPMNDiagram`,
 * while `prepare_data` is drawn expanded with its children filed in the parent
 * plane. The editor used to treat those two as different kinds of thing — badge and
 * drill-on-double-click for one, no badge and toggle-on-double-click for the other.
 * Every test below asserts the SAME behaviour for both.
 */

/**
 * What an element's `<g>` actually covers on screen, plus its computed `display`.
 *
 * `toBeVisible` is unusable for a straight connection: Playwright reads an
 * axis-aligned line's zero-height box as hidden. It is also exactly the assertion
 * that MISSED the reported bug, where the flows were painted-over rather than hidden.
 */
async function painted(locator: import('@playwright/test').Locator): Promise<{
  x: number; y: number; width: number; height: number; display: string;
}> {
  return locator.evaluate((g) => {
    const rect = (g as SVGGElement).getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      display: getComputedStyle(g as Element).display,
    };
  });
}

async function openExample(page: import('@playwright/test').Page): Promise<void> {
  await gotoModeler(page);
  await page.getByTestId('open-file-input').setInputFiles({
    name: 'sklearn_pipeline.studyflow.png',
    mimeType: 'image/png',
    buffer: readFileSync(path.join(process.cwd(), 'assets/schemas/examples/AI & ML/sklearn_pipeline.studyflow.png')),
  });
  await expect(page.locator('g[data-element-id="select_model"]')).toBeVisible();
}

test.describe('sub-process drill-down', () => {
  test('every SELECTED sub-process shows the drill-down badge, whichever way its contents are stored', async ({ page }) => {
    await openExample(page);

    // Badges are selection-gated: nothing selected, nothing offered.
    await expect(page.getByTitle('Open select_model')).toBeHidden();
    await expect(page.getByTitle('Open prepare_data')).toBeHidden();

    // The reported defect, from the outside: `select_model` owns a nested plane and
    // `prepare_data` does not, and that difference used to decide whether the trip in
    // was offered at all. Selecting either offers the same badge.
    await page.locator('g[data-element-id="select_model"]').click();
    await expect(page.getByTitle('Open select_model')).toBeVisible();
    await page.locator('g[data-element-id="evaluate_and_report"]').click();
    await expect(page.getByTitle('Open evaluate_and_report')).toBeVisible();
    // …and the badge follows the selection out again.
    await expect(page.getByTitle('Open select_model')).toBeHidden();
    await page.locator('g[data-element-id="prepare_data"]').click({ position: { x: 12, y: 12 } });
    await expect(page.getByTitle('Open prepare_data')).toBeVisible();
    // At the root the trail is one crumb long, and the reference draws none.
    await expect(page.getByTestId('drilldown-breadcrumbs')).toHaveCount(0);
  });

  test('an expanded sub-process draws the flows between its children, not just the children', async ({ page }) => {
    await openExample(page);

    // Defect 2. The interior shapes were always drawn; the interior EDGES were not —
    // they sat in a connections layer below every shape, so the container's own opaque
    // frame painted over them. Nothing about their `display` was ever wrong, which is
    // why this assertion is about geometry and paint order rather than visibility.
    const frame = page.locator('g[data-element-id="prepare_data"]');
    const flow = page.locator('g[data-element-id="Flow_Select_Features_Select_Target"]');
    await expect(flow).toBeAttached();

    // A horizontal flow has a zero-height box, which `toBeVisible` reads as hidden —
    // so painted-ness is measured directly: not `display:none`, and a real extent
    // inside the frame that used to cover it.
    const flowBox = await painted(flow);
    expect(flowBox.display).not.toBe('none');
    expect(flowBox.width).toBeGreaterThan(0);
    const frameBox = (await frame.boundingBox())!;
    expect(flowBox.x).toBeGreaterThanOrEqual(frameBox.x - 1);
    expect(flowBox.y).toBeGreaterThanOrEqual(frameBox.y - 1);
    expect(flowBox.x + flowBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width + 1);

    // Painted AFTER the frame, in the one element layer — the invariant that broke.
    const order = await page.locator('svg.sf-canvas [data-layer="elements"] > g')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-element-id')));
    expect(order.indexOf('Flow_Select_Features_Select_Target'))
      .toBeGreaterThan(order.indexOf('prepare_data'));
    // …and a root-level flow still passes under the shape it points at.
    expect(order.indexOf('flow_start')).toBeLessThan(order.indexOf('prepare_data'));
  });

  test('the badge enters the plane and the breadcrumb shows the path back', async ({ page }) => {
    await openExample(page);

    // Select first: the badge only paints on the selected container.
    await page.locator('g[data-element-id="select_model"]').click();
    await page.getByTitle('Open select_model').click();

    // The plane's own contents are on screen…
    await expect(page.locator('g[data-element-id="cross_validate"]')).toBeVisible();
    await expect(page.locator('g[data-element-id="build_pipeline"]')).toBeVisible();
    // …and the parent plane's are not.
    await expect(page.locator('g[data-element-id="prepare_data"]')).toBeHidden();

    const crumbs = page.getByTestId('drilldown-breadcrumbs');
    await expect(crumbs).toBeVisible();
    await expect(crumbs).toContainText('sklearn_pipeline');
    await expect(crumbs).toContainText('select_model');

    // Clicking the root crumb restores the parent plane.
    await page.getByTestId('breadcrumb-sklearn_pipeline').click();
    await expect(page.locator('g[data-element-id="prepare_data"]')).toBeVisible();
    await expect(page.locator('g[data-element-id="cross_validate"]')).toBeHidden();
    await expect(page.getByTestId('drilldown-breadcrumbs')).toHaveCount(0);
  });

  test('the badge enters an in-parent sub-process too, through a synthesized scope', async ({ page }) => {
    await openExample(page);

    // The caption, not the body: a body click would land on a child of the
    // expanded frame. Selecting paints the badge; the badge takes the trip.
    await page.locator('g[data-element-id="prepare_data"]').click({ position: { x: 12, y: 12 } });
    await page.getByTitle('Open prepare_data').click();

    // Same trip, same trail, for a container the document gave no plane of its own.
    const crumbs = page.getByTestId('drilldown-breadcrumbs');
    await expect(crumbs).toContainText('sklearn_pipeline');
    await expect(crumbs).toContainText('prepare_data');
    await expect(page.locator('g[data-element-id="select_features"]')).toBeVisible();
    expect((await painted(page.locator('g[data-element-id="Flow_Select_Features_Select_Target"]'))).display)
      .not.toBe('none');
    await expect(page.locator('g[data-element-id="select_model"]')).toBeHidden();

    await page.getByTestId('breadcrumb-sklearn_pipeline').click();
    await expect(page.locator('g[data-element-id="select_model"]')).toBeVisible();
    await expect(page.getByTestId('drilldown-breadcrumbs')).toHaveCount(0);
  });

  test('double-clicking a collapsed sub-process expands it in place and re-routes its flows', async ({ page }) => {
    await openExample(page);

    const flow = page.locator('g[data-element-id="flow_select_done"] .sf-connection-line');
    const before = await flow.getAttribute('data-waypoints');
    // The shape's own `<rect>` carries its footprint in DIAGRAM units, so the
    // assertion survives the zoom a re-fit chooses — which a pixel box does not.
    // `:not(.sf-outline)` skips the selection outline, which is drawn in the same
    // group and is 10 units wider than the shape it wraps.
    const frameWidth = page.locator('g[data-element-id="select_model"] rect:not(.sf-outline)').first();
    await expect(frameWidth).toHaveAttribute('width', '100');

    await page.locator('g[data-element-id="select_model"]').dblclick();

    // Defect 1: the double click no longer navigates — it opens the container where
    // it stands, and the badge keeps the trip.
    await expect(page.getByTestId('drilldown-breadcrumbs')).toHaveCount(0);
    await expect(page.locator('g[data-element-id="select_model"]')).toBeVisible();
    await expect(page.locator('g[data-element-id="cross_validate"]')).toBeVisible();
    // Fitted to the interior it now holds, not to the flat 350-unit default.
    await expect.poll(async () => Number(await frameWidth.getAttribute('width')))
      .toBeGreaterThan(350);

    // Defect 3: the outline changed, so the flows docked to it moved with it. They
    // used to keep the waypoints of the 100x80 box and start inside the new frame.
    await expect.poll(async () => flow.getAttribute('data-waypoints')).not.toBe(before);

    // …and it is ONE undo step: the flag, the bounds and the waypoints all go back
    // together, because they were written in one revision.
    await pressOnCanvas(page, 'ControlOrMeta+z');
    await expect.poll(async () => flow.getAttribute('data-waypoints')).toBe(before);
    await expect(page.locator('g[data-element-id="select_model"] rect:not(.sf-outline)').first())
      .toHaveAttribute('width', '100');
    await expect(page.locator('g[data-element-id="cross_validate"]')).toBeHidden();
  });

  test('double-clicking an in-parent sub-process collapses it, and its name still renames', async ({ page }) => {
    await openExample(page);

    const frame = page.locator('g[data-element-id="prepare_data"]');
    const width = page.locator('g[data-element-id="prepare_data"] rect:not(.sf-outline)').first();
    await expect(width).toHaveAttribute('width', '650');
    const box = (await frame.boundingBox())!;

    // The BODY, clear of the caption: it collapses in place rather than navigating.
    await frame.dblclick({ position: { x: 12, y: box.height - 12 } });
    await expect(page.getByTestId('drilldown-breadcrumbs')).toHaveCount(0);
    await expect(page.locator('g[data-element-id="select_features"]')).toBeHidden();
    await expect(page.locator('g[data-element-id="prepare_data"] rect:not(.sf-outline)').first())
      .toHaveAttribute('width', '100');

    await pressOnCanvas(page, 'ControlOrMeta+z');
    await expect(page.locator('g[data-element-id="select_features"]')).toBeVisible();
    await expect(page.locator('g[data-element-id="prepare_data"] rect:not(.sf-outline)').first())
      .toHaveAttribute('width', '650');

    // Rename stays reachable: `e` on the selection, and a double click on the
    // container's own NAME rather than on its body.
    await page.locator('g[data-element-id="prepare_data"]').click({ position: { x: 12, y: 12 } });
    await pressOnCanvas(page, 'e');
    await expectEditorText(page, 'prepare_data');
    await pressOnCanvas(page, 'Escape');
    await expect(labelEditor(page)).toHaveCount(0);
  });

  test('the context pad names the expand toggle, for both storage kinds', async ({ page }) => {
    await openExample(page);

    for (const [id, expected] of [['prepare_data', 'Collapse'], ['select_model', 'Expand']] as const) {
      await page.locator(`g[data-element-id="${id}"]`).click({ position: { x: 12, y: 12 } });
      await expect(page.getByTestId('context-pad')).toBeVisible();
      await page.getByTestId('context-pad-expand.toggle').hover();
      await expect(page.getByTestId('context-pad-tooltip')).toHaveText(expected);
      // Drilling in is NOT duplicated here: the ↘ badge is already beside the
      // selection, and it is what the two tests above take the trip through.
      await expect(page.getByTestId('context-pad-drilldown.enter')).toHaveCount(0);
    }
  });

  test('a sub-process dropped from the palette is authorable: badge, plane, contents', async ({ page }) => {
    // The dead end this closes: the drop used to emit a lone `<bpmn2:subProcess/>`
    // whose `BPMNShape` carried no `isExpanded` and no diagram of its own, so it
    // rendered as a bare box — no ⊞, no badge, double-click inert — and there was no
    // route through the UI to put anything inside it.
    await gotoModeler(page);
    await addPaletteElement(page, 'Containers', 'Sub-process', { x: 320, y: 240 });
    await pressOnCanvas(page, 'Escape');

    const sub = page.locator('g[data-element-type="bpmn:SubProcess"]').first();
    await expect(sub).toBeVisible();
    const id = await sub.getAttribute('data-element-id');

    // Drawn collapsed (the ⊞ marker) and, once selected, offering the trip in.
    await expect(sub.locator('[data-icon-key="subprocess"]')).toHaveCount(1);
    await sub.click();
    const badge = page.getByTitle(`Open ${id}`);
    await expect(badge).toBeVisible();

    // In: the trail appears, and a task dropped here lands INSIDE the sub-process.
    await badge.click();
    await expect(page.getByTestId('drilldown-breadcrumbs')).toContainText(String(id));
    await addPaletteElement(page, 'Activities', 'Task', { x: 400, y: 300 });
    await pressOnCanvas(page, 'Escape');
    const task = page.locator('g[data-element-type="bpmn:Task"]').first();
    await expect(task).toBeVisible();
    const taskId = await task.getAttribute('data-element-id');

    // The document says so: the task's business object is filed under the
    // sub-process, and its DI in the plane the drop minted.
    const bpmn = await readDownloadText(await exportDiagram(page, 'bpmn'));
    expect(bpmn).toContain(`isExpanded="false"`);
    const subProcess = bpmn.slice(bpmn.indexOf(`<bpmn2:subProcess id="${id}"`));
    expect(subProcess.slice(0, subProcess.indexOf('</bpmn2:subProcess>'))).toContain(String(taskId));
    expect(bpmn.match(/<bpmndi:BPMNDiagram/g) ?? []).toHaveLength(2);

    // Out: the sub-process is collapsed again and its contents are off screen.
    await page.getByTestId('drilldown-breadcrumbs').getByRole('button').first().click();
    await expect(sub).toBeVisible();
    await expect(task).toBeHidden();
  });
});
