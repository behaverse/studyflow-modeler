import { expect, test } from '@playwright/test';

import { addPaletteElement, exportDiagram, gotoModeler, readDownloadText, runPaletteCommand } from './utils';

/** The per-expression language select: BPMN's own `language` field, surfaced under expression fields. */
test('an expression field carries a subtle language select that persists', async ({ page }) => {
  await gotoModeler(page);

  await runPaletteCommand(page, 'New...');
  await page.getByTestId('example-drawn_loop').click();
  await expect(page.locator('g[data-element-id="Say"]')).toBeVisible();

  await page.locator('g[data-element-id="Again_label"]').click();
  const condition = page.locator('textarea[name="bpmn:conditionExpression"]');
  await expect(condition).toHaveValue("state.trace.count('Gate') < 8");

  // Unprefixed by default, the engine's own language.
  const language = page.getByLabel('Expression language');
  await expect(language).toHaveValue('');

  await language.selectOption('python');

  const yaml = await readDownloadText(await exportDiagram(page, 'studyflow'));
  expect(yaml).toContain('language: python');

  // No text, no element: clearing the field removes the expression, so the conditional-flow marker follows.
  await condition.fill('');
  const bpmn = await readDownloadText(await exportDiagram(page, 'bpmn'));
  expect(bpmn).not.toContain('conditionExpression');
});

test('a data wire\'s binding and the loop marker\'s condition get the select too', async ({ page }) => {
  await gotoModeler(page);

  await runPaletteCommand(page, 'New...');
  await page.getByTestId('example-sklearn_pipeline').click();
  await expect(page.locator('g[data-element-id="select_features"]')).toBeVisible();

  await page.getByTestId('modeler-canvas').hover();
  await page.mouse.wheel(0, -160);
  await page.locator('[data-element-id="DataInput_Input_Features"]').click({ force: true });
  await expect(page.locator('input[name="bpmn:name"]')).toBeVisible();
  const wireBody = page.locator('textarea[name="bpmn:transformation"]');
  await expect(wireBody).toHaveValue('self');
  // The placeholder is the live default, the source element's own name.
  await expect(wireBody).toHaveAttribute('placeholder', 'input_dataset');
  const wireLanguage = page.getByLabel('Expression language');
  await expect(wireLanguage).toHaveValue('');
  await wireLanguage.selectOption('python');

  const yaml = await readDownloadText(await exportDiagram(page, 'studyflow'));
  expect(yaml).toContain('language: python');

  await page.locator('g[data-element-id="select_features"]').click();
  await page.getByTestId('inspector-root').getByRole('tab', { name: 'Execution' }).click();
  await expect(page.getByTestId('inspector-root')).toContainText('self = input_dataset');
  await expect(page.getByTestId('inspector-root').locator('select')).toHaveCount(0);

  await runPaletteCommand(page, 'New...');
  await page.getByTestId('new-diagram-blank').click();
  await addPaletteElement(page, 'Activities', 'Task', { x: 360, y: 200 });
  await page.getByTestId('inspector-root').getByRole('tab', { name: 'Execution' }).click();
  await page.getByTestId('loop-kind').click();
  await page.getByRole('option', { name: /^Loop/i }).click();
  await page.getByTestId('loop-section').locator('textarea[name="loopCondition"]').fill('score < 0.9');
  const loopLanguage = page.getByTestId('loop-section').getByLabel('Expression language');
  await expect(loopLanguage).toBeVisible();
  await loopLanguage.selectOption('python');

  const loopYaml = await readDownloadText(await exportDiagram(page, 'studyflow'));
  expect(loopYaml).toContain('language: python');
});
