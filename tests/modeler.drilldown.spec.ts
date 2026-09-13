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

async function openExample(page: import('@playwright/test').Page): Promise<void> {
  await gotoModeler(page);
  await page.getByTestId('open-file-input').setInputFiles(examplePath('sklearn_pipeline'));
  await expect(page.locator('g[data-element-id="select_model"]')).toBeVisible();
}

/** The context pad entry that enters the selected container. */
const drilldown = (page: import('@playwright/test').Page) => page.getByTestId('context-pad-drilldown');

test.describe('sub-process drill-down', () => {
  test('the badge enters a sub-process and the breadcrumb leads back, whichever way its contents are stored', async ({ page }) => {
    await openExample(page);
    const shape = (id: string) => page.locator(`g[data-element-id="${id}"]`);
    const crumbs = page.getByTestId('drilldown-breadcrumbs');
    // Each row: the container, a shape inside it, and one of the parent plane's. An expanded
    // container is selected by its caption: a click on its body would land on a child.
    const CASES: [id: string, click: { position?: { x: number; y: number } }, inside: string, outside: string][] = [
      ['select_model', {}, 'cross_validate', 'prepare_data'],
      ['prepare_data', { position: { x: 12, y: 12 } }, 'select_features', 'select_model'],
    ];
    for (const [id, click, inside, outside] of CASES) {
      // Select first: the badge is offered on the selected container.
      await shape(id).click(click);
      await drilldown(page).click();

      // The container's contents are on screen, the parent plane's are not, and the trail says where.
      await expect(shape(inside), id).toBeVisible();
      await expect(shape(outside), id).toBeHidden();
      await expect(crumbs, id).toContainText('sklearn_pipeline');
      await expect(crumbs, id).toContainText(id);

      // The root crumb leads back, and at the root there is no trail to draw.
      await page.getByTestId('breadcrumb-sklearn_pipeline').click();
      await expect(shape(outside), id).toBeVisible();
      await expect(crumbs, id).toHaveCount(0);
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
