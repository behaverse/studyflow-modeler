import { expect, test } from '@playwright/test';

import { addPaletteElement, exportDiagram, gotoModeler, readDownloadText, runPaletteCommand } from './utils';

/**
 * The per-expression language select: BPMN's own `language` field on the
 * expression element, surfaced as a subtle dropdown under expression fields.
 * Unset means "the evaluating engine's own language"; the choice is validated
 * only by the engine that eventually evaluates it, never by the modeler.
 */
test('an expression field carries a subtle language select that persists', async ({ page }) => {
  await gotoModeler(page);

  await runPaletteCommand(page, 'Examples...');
  await page.getByTestId('example-drawn_loop').click();
  await expect(page.locator('g[data-element-id="Say"]')).toBeVisible();

  // Selecting the conditioned back-edge (via its label) opens its inspector.
  await page.locator('g[data-element-id="Again_label"]').click();
  const condition = page.locator('textarea[name="bpmn:conditionExpression"]');
  await expect(condition).toHaveValue("state.trace.count('Gate') < 8");

  // Unprefixed by default — the engine's own language.
  const language = page.getByLabel('Expression language');
  await expect(language).toHaveValue('');

  await language.selectOption('python');

  // The choice is BPMN's own per-expression field, so it survives export: the
  // YAML keeps the expression structured (body + language) instead of flat.
  const yaml = await readDownloadText(await exportDiagram(page, 'studyflow'));
  expect(yaml).toContain('language: python');

  // No text, no element: clearing the field removes the expression itself,
  // so the canvas marker (the conditional-flow diamond) follows presence.
  await condition.fill('');
  const bpmn = await readDownloadText(await exportDiagram(page, 'bpmn'));
  expect(bpmn).not.toContain('conditionExpression');
});

test('a data wire\'s binding and the loop marker\'s condition get the select too', async ({ page }) => {
  await gotoModeler(page);

  await runPaletteCommand(page, 'Examples...');
  await page.getByTestId('example-sklearn_pipeline').click();
  await expect(page.locator('g[data-element-id="Select_Features"]')).toBeVisible();

  // A data association's expression is BPMN's own `transformation`, edited
  // on the wire itself — name, id, and the expression, with the one subtle
  // language select riding on the element that natively carries `language`.
  await page.getByTestId('modeler-canvas').hover();
  await page.mouse.wheel(0, -160);
  await page.locator('g.djs-connection[data-element-id="DataInput_Input_Features"]').click({ force: true });
  await expect(page.locator('input[name="bpmn:name"]')).toBeVisible();
  const wireBody = page.locator('textarea[name="bpmn:transformation"]');
  await expect(wireBody).toHaveValue('self');
  // The placeholder is the live default — the source element's own name.
  await expect(wireBody).toHaveAttribute('placeholder', 'digits.csv');
  const wireLanguage = page.getByLabel('Expression language');
  await expect(wireLanguage).toHaveValue('');
  await wireLanguage.selectOption('python');

  const yaml = await readDownloadText(await exportDiagram(page, 'studyflow'));
  expect(yaml).toContain('language: python');

  // The step's Execution tab keeps the auto-detected rows read-only — the
  // wire is the editing surface — and offers no language select of its own.
  await page.locator('g[data-element-id="Select_Features"]').click();
  await page.getByTestId('inspector-root').getByRole('tab', { name: 'Execution' }).click();
  await expect(page.getByTestId('inspector-root')).toContainText('self = digits.csv');
  await expect(page.getByTestId('inspector-root').locator('select')).toHaveCount(0);

  // The standard-loop marker's condition renders in its own Loop section —
  // same subtle select, reaching the expression one hop down. Built fresh:
  // the catalog examples stack too densely for reliable canvas clicks.
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
