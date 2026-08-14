import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { addPaletteElement, exportDiagram, gotoModeler, pressOnCanvas, readDownloadText } from './utils';

/** The inspector's Execution tab: `bpmn:Property` declarations plus the data associations that bind them. */

test.describe('Inspector execution tab', () => {
  test('declares typed properties that serialize as plain BPMN properties', async ({ page }) => {
    await gotoModeler(page);

    const inspector = page.getByTestId('inspector-root');

    await inspector.getByRole('tab', { name: 'Execution' }).click();
    await page.getByTestId('state-scope-help').hover();
    await expect(page.getByTestId('state-scope-help-bubble')).toContainText('opens a scope');

    await page.getByTestId('add-property').click();
    await page.getByLabel('Property name (Property_1)').fill('arm');
    await page.getByTestId('property-type-Property_1').click();
    await page.getByRole('option', { name: 'string', exact: true }).click();
    await expect(page.getByTestId('property-type-Property_1')).toHaveValue('string');

    await page.getByTestId('add-property').click();
    await page.getByLabel('Property name (Property_2)').fill('failed_trials');
    await page.getByTestId('property-type-Property_2').click();
    await page.getByRole('option', { name: 'integer', exact: true }).click();

    const studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));

    expect(studyflowText).toContain('properties:');
    expect(studyflowText).toContain('name: arm');
    expect(studyflowText).toContain('name: failed_trials');
    expect(studyflowText).toContain('type: bpmn:ItemDefinition');
    expect(studyflowText).toContain('structureRef: string');
    expect(studyflowText).toContain('structureRef: integer');
    expect(studyflowText).toContain('itemSubjectRef: ItemDefinition_string');
    expect(studyflowText).toContain('itemSubjectRef: ItemDefinition_integer');
  });

  test('declaring is the scope\'s act: containers get the list, steps bind, and edits undo', async ({ page }) => {
    await gotoModeler(page);
    const inspector = page.getByTestId('inspector-root');

    await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
    await inspector.getByRole('tab', { name: 'Execution' }).click();
    await expect(inspector.getByRole('button', { name: 'Repeats' })).toBeVisible();
    await expect(inspector.getByTestId('state-section')).toHaveCount(0);

    await addPaletteElement(page, 'Containers', 'SubProcess', { x: 620, y: 400 });
    await page.keyboard.press('Escape');
    await inspector.getByRole('tab', { name: 'Execution' }).click();
    await page.getByTestId('state-scope-help').hover();
    await expect(page.getByTestId('state-scope-help-bubble')).toContainText('opens a scope');

    await page.getByTestId('add-property').click();
    await page.getByLabel('Property name (Property_1)').fill('trial_index');
    await expect(page.getByLabel('Property name (Property_1)')).toHaveValue('trial_index');

    await page.getByRole('button', { name: 'Remove trial_index' }).click();
    await expect(page.getByLabel('Property name (Property_1)')).toHaveCount(0);

    await pressOnCanvas(page, 'ControlOrMeta+z');
    await expect(page.getByLabel('Property name (Property_1)')).toHaveValue('trial_index');
  });

  test('types are free text: the diagram\'s own are suggested, new ones are declared', async ({ page }) => {
    await gotoModeler(page);

    await page.getByTestId('open-file-input').setInputFiles({
      name: 'sklearn_pipeline.studyflow.png',
      mimeType: 'image/png',
      buffer: readFileSync(path.join(process.cwd(), 'assets/examples/sklearn_pipeline.studyflow.png')),
    });
    // The `select_model` shape is on the root plane, so its appearance is the imported-and-rendered signal.
    await expect(page.locator('g[data-element-id="select_model"]')).toBeVisible();

    await page.getByTestId('inspector-root').getByRole('tab', { name: 'Execution' }).click();
    await expect(page.getByTestId('property-type-x_train')).toHaveValue('pandas.DataFrame');

    await page.getByTestId('add-property').click();
    await page.getByLabel('Property name (Property_1)').fill('folds');
    await page.getByTestId('property-type-Property_1').click();
    await page.getByRole('option', { name: 'pandas.Series', exact: true }).click();
    await expect(page.getByTestId('property-type-Property_1')).toHaveValue('pandas.Series');

    await page.getByTestId('add-property').click();
    await page.getByLabel('Property name (Property_2)').fill('embeddings');
    await page.getByTestId('property-type-Property_2').fill('torch.Tensor');
    await page.getByRole('option', { name: 'Use torch.Tensor' }).click();
    await expect(page.getByTestId('property-type-Property_2')).toHaveValue('torch.Tensor');

    const studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
    expect(studyflowText).toContain('name: folds');
    expect(studyflowText).toContain('itemSubjectRef: Item_Series');
    expect(studyflowText).toContain('structureRef: torch.Tensor');
    expect(studyflowText).toContain('itemSubjectRef: ItemDefinition_torch.Tensor');
  });

  test('the data-association view reports property bindings, which are never drawn', async ({ page }) => {
    await gotoModeler(page);

    const source = readFileSync(
      path.join(process.cwd(), 'assets/examples/sklearn_pipeline.studyflow.png'),
    );
    await page.getByTestId('open-file-input').setInputFiles({
      name: 'sklearn_pipeline.studyflow.png',
      mimeType: 'image/png',
      buffer: source,
    });
    await expect(page.locator('g[data-element-id="select_model"]')).toBeVisible();

    // `cross_validate` sits on the collapsed `select_model` phase's own DI plane — drill down first.
    await page.getByTitle('Open select_model').click();
    await expect(page.locator('g[data-element-id="cross_validate"]')).toBeVisible();

    await page.locator('g[data-element-id="cross_validate"]').click();
    await page.getByTestId('inspector-root').getByRole('tab', { name: 'Execution' }).click();

    const inputs = page.getByTestId('data-flow-inputs');
    const outputs = page.getByTestId('data-flow-outputs');
    await expect(inputs).toContainText('estimator');
    await expect(inputs).toContainText('x_train');
    await expect(inputs).toContainText('y_train');
    await expect(outputs).toContainText('cv_scores');

    await expect(page.getByLabel('Transformation for x_train')).toHaveValue('X');
    await expect(page.getByLabel('Transformation for y_train')).toHaveValue('y');
    await expect(page.getByLabel('Transformation for estimator')).toHaveValue('');

    await expect(page.getByRole('button', { name: 'Unbind x_train' })).toBeVisible();

    await page.locator('g[data-element-id="summarize_cv"]').click();
    await expect(inputs).toContainText('self = cv_fold_report');
    await expect(page.getByLabel('Transformation for cv_fold_report')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Unbind cv_fold_report' })).toHaveCount(0);
    await expect(inputs.getByTitle('self = cv_fold_report (data object)')).toBeVisible();
  });

  test('a property is associated with a step from the inspector, and the association persists', async ({ page }) => {
    await gotoModeler(page);
    await page.getByTestId('open-file-input').setInputFiles({
      name: 'sklearn_pipeline.studyflow.png',
      mimeType: 'image/png',
      buffer: readFileSync(path.join(process.cwd(), 'assets/examples/sklearn_pipeline.studyflow.png')),
    });
    await expect(page.locator('g[data-element-id="select_model"]')).toBeVisible();

    // `build_pipeline` is drawn on the collapsed `select_model` phase's own plane — drill down first.
    await page.getByTitle('Open select_model').click();
    await expect(page.locator('g[data-element-id="build_pipeline"]')).toBeVisible();

    await page.locator('g[data-element-id="build_pipeline"]').click();
    await page.getByTestId('inspector-root').getByRole('tab', { name: 'Execution' }).click();

    await page.getByTestId('bind-input').click();
    await expect(page.getByRole('option', { name: 'x_train', exact: true })).toBeVisible();

    await expect(page.getByRole('option', { name: 'features', exact: true })).toHaveCount(0);

    await page.getByRole('option', { name: 'x_train', exact: true }).click();
    await page.getByLabel('Transformation for x_train').fill('X');

    const studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
    // Extract the step's YAML block by key + indentation — how deeply the example nests it is not under test.
    const lines = studyflowText.split('\n');
    const start = lines.findIndex((l) => /^\s+build_pipeline:\s*$/.test(l));
    expect(start, 'the exported YAML declares build_pipeline').toBeGreaterThan(-1);
    const depth = lines[start].search(/\S/);
    let end = start + 1;
    while (end < lines.length && (lines[end].trim() === '' || lines[end].search(/\S/) > depth)) end += 1;
    const block = lines.slice(start, end).join('\n');

    expect(block).toContain('dataInputAssociations:');
    expect(block).toMatch(/sourceRef:\n\s+- x_train/);
    expect(block).toContain('transformation: X');

    // The id names the BPMN type it creates, so the generated `DataInput_x_train` cannot
    // collide with the example's own `DataOutput_X_Train`.
    expect(studyflowText.match(/DataInput_x_train:/g) ?? []).toHaveLength(1);
    expect(studyflowText).toContain('DataOutput_X_Train:');
  });

  test('a gateway gets no Execution tab', async ({ page }) => {
    await gotoModeler(page);
    await addPaletteElement(page, 'Gateways', 'Exclusive', { x: 360, y: 200 });

    const inspector = page.getByTestId('inspector-root');
    await expect(inspector.getByRole('tab', { name: 'General' })).toBeVisible();
    await expect(inspector.getByRole('tab', { name: 'Execution' })).toHaveCount(0);
  });
});
