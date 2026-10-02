import { expect, test } from '@playwright/test';

import { diagramTitle, examplePath, gotoModeler, openCommandPalette } from './utils';

/**
 * Sub-process drill-down, end to end: the context pad's badge, the breadcrumb trail
 * and the plane each shows. What a double click does to a container, how a dropped
 * one lands and what is dropped inside it are pinned in jsdom
 * (`packages/canvas/tests/canvas.unit.spec.ts`).
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
  test('the badge enters a sub-process and the breadcrumb leads back, whichever way its contents are stored; drilled in, a rename names the study', async ({ page }) => {
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

    // Drilled in, the nav bar names the study, and a rename renames the study, not the sub-process:
    // the trail reads the new name at once, and the sub-process keeps its own.
    await shape('select_model').click();
    await drilldown(page).click();
    await expect(diagramTitle(page)).toHaveText('sklearn_pipeline');
    await diagramTitle(page).click();
    await page.getByTestId('diagram-name-input').fill('Pipeline');
    await page.getByTestId('diagram-name-input').press('Enter');
    await expect(diagramTitle(page)).toHaveText('Pipeline');
    await expect(page.getByTestId('breadcrumb-sklearn_pipeline')).toContainText('Pipeline');
    await expect(page.getByTestId('breadcrumb-select_model')).toContainText('select_model');
  });

  test('the command palette finds a step by name and shows it, inside the sub-process that holds it', async ({ page }) => {
    await openExample(page);
    await expect(page.locator('g[data-element-id="cross_validate"]')).toBeHidden();
    await openCommandPalette(page);
    await page.getByRole('dialog').getByRole('textbox').fill('cross_val');
    await page.getByRole('dialog').getByRole('button', { name: /cross_validate/ }).click();

    await expect(page.getByTestId('breadcrumb-select_model')).toBeVisible();
    await expect(page.locator('g[data-element-id="cross_validate"]')).toHaveClass(/selected/);
    await expect(page.locator('g[data-element-id="cross_validate"]')).toBeInViewport();
  });
});
