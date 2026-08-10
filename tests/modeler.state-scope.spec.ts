import { expect, test } from '@playwright/test';

import { addPaletteElement, exportDiagram, gotoModeler, readDownloadText } from './utils';

/** Where run state is declared vs. where it is bound. */
test.describe('Property scoping in the inspector', () => {
  test('a plain event has no Execution tab', async ({ page }) => {
    await gotoModeler(page);

    await page.locator('g[data-element-id="StartEvent_1"]').click();
    const inspector = page.getByTestId('inspector-root');
    await expect(inspector).toContainText('bpmn:StartEvent');
    await expect(inspector.getByRole('tab', { name: 'Execution' })).toHaveCount(0);
  });

  test('the study declares, a step binds from the picker', async ({ page }) => {
    await gotoModeler(page);
    const inspector = page.getByTestId('inspector-root');

    await inspector.getByRole('tab', { name: 'Execution' }).click();
    await page.getByTestId('add-property').click();
    await page.getByLabel('Property name (Property_1)').fill('split_ratio');

    await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
    await inspector.getByRole('tab', { name: 'Execution' }).click();
    await expect(inspector.getByTestId('state-section')).toHaveCount(0);
    await page.getByTestId('bind-input').click();
    await page.getByRole('option', { name: 'split_ratio' }).click();
    await expect(inspector.getByRole('button', { name: 'Unbind split_ratio' })).toBeVisible();

    const studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
    expect(studyflowText).toContain('name: split_ratio');
    expect(studyflowText).toContain('DataInput_Property_1');
  });
});
