import { expect, test } from '@playwright/test';

import {
  addPaletteElement,
  examplePath,
  exportDiagram,
  gotoModeler,
  pressOnCanvas,
  readDownloadText,
} from './utils';

/**
 * Sub-process drill-down, end to end: the context pad's badge, the breadcrumb trail
 * and the plane each shows. What a double click does to a container is pinned in
 * jsdom (`packages/canvas/tests/canvas.unit.spec.ts`).
 *
 * `sklearn_pipeline` is the fixture because it ships BOTH shapes of the feature at
 * once: `select_model` is drawn collapsed and owns its own `bpmndi:BPMNDiagram`,
 * while `prepare_data` is drawn expanded with its children filed in the parent
 * plane. The editor used to treat those two as different kinds of thing, so the
 * tests assert the same behaviour for both.
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
  await page.getByTestId('open-file-input').setInputFiles(examplePath('sklearn_pipeline'));
  await expect(page.locator('g[data-element-id="select_model"]')).toBeVisible();
}

/** The context pad entry that enters the selected container. */
const drilldown = (page: import('@playwright/test').Page) => page.getByTestId('context-pad-drilldown');

test.describe('sub-process drill-down', () => {
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
    await drilldown(page).click();

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
    await drilldown(page).click();

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
    const badge = drilldown(page);
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
    // sub-process, and its DI in the one plane the document has.
    const bpmn = await readDownloadText(await exportDiagram(page, 'bpmn'));
    expect(bpmn).toContain(`isExpanded="false"`);
    const subProcess = bpmn.slice(bpmn.indexOf(`<bpmn2:subProcess id="${id}"`));
    expect(subProcess.slice(0, subProcess.indexOf('</bpmn2:subProcess>'))).toContain(String(taskId));
    expect(bpmn.match(/<bpmndi:BPMNDiagram/g) ?? []).toHaveLength(1);

    // Out: the sub-process is collapsed again and its contents are off screen.
    await page.getByTestId('drilldown-breadcrumbs').getByRole('button').first().click();
    await expect(sub).toBeVisible();
    await expect(task).toBeHidden();
  });
});
