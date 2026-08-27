import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
  addPaletteElement,
  exportDiagram,
  gotoModeler,
  pressOnCanvas,
  readDownloadText,
} from './utils';

/**
 * Sub-process drill-down, end to end (`scratchpad/subprocess-drilldown-spec.md`,
 * frames `edge-videos/sub/*`).
 *
 * `sklearn_pipeline` is the fixture because it ships the real shape of the feature:
 * `select_model` is drawn COLLAPSED and owns its own `bpmndi:BPMNDiagram`, so its
 * contents exist in the document but are on a plane of their own — invisible until
 * you drill in. The three things the reference recording does are the three things
 * asserted here: the badge is there, entering shows the plane and the trail, and a
 * crumb brings you back.
 */

async function openExample(page: import('@playwright/test').Page): Promise<void> {
  await gotoModeler(page);
  await page.getByTestId('open-file-input').setInputFiles({
    name: 'sklearn_pipeline.studyflow.png',
    mimeType: 'image/png',
    buffer: readFileSync(path.join(process.cwd(), 'assets/examples/sklearn_pipeline.studyflow.png')),
  });
  await expect(page.locator('g[data-element-id="select_model"]')).toBeVisible();
}

test.describe('sub-process drill-down', () => {
  test('a collapsed sub-process shows the drill-down badge, an expanded one does not', async ({ page }) => {
    await openExample(page);

    await expect(page.getByTitle('Open select_model')).toBeVisible();
    // `prepare_data` is inline-expanded: its contents are already on screen, so it
    // offers no trip (`edge-videos/sub/frame_07`).
    await expect(page.getByTitle('Open prepare_data')).toHaveCount(0);
    // At the root the trail is one crumb long, and the reference draws none.
    await expect(page.getByTestId('drilldown-breadcrumbs')).toHaveCount(0);
  });

  test('the badge enters the plane and the breadcrumb shows the path back', async ({ page }) => {
    await openExample(page);

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

  test('double-clicking a collapsed sub-process drills in rather than expanding it', async ({ page }) => {
    await openExample(page);

    await page.locator('g[data-element-id="select_model"]').dblclick();

    await expect(page.getByTestId('drilldown-breadcrumbs')).toContainText('select_model');
    await expect(page.locator('g[data-element-id="cross_validate"]')).toBeVisible();
    // Navigation is view-only: the sub-process is not opened in place, so nothing
    // was written and undo has nothing to give back.
    await expect(page.locator('g[data-element-id="select_model"]')).toBeHidden();
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

    // Drawn collapsed (the ⊞ marker) and offering the trip in.
    await expect(sub.locator('[data-icon-key="subprocess"]')).toHaveCount(1);
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
