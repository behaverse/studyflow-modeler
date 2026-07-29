import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { addPaletteElement, exportDiagram, gotoModeler, pressOnCanvas, readDownloadText } from './utils';

/**
 * The inspector's Execution tab: `bpmn:Property` declarations, typed by a
 * shared `bpmn:ItemDefinition`, above the data associations that wire them
 * into the step.
 *
 * Properties are never drawn (BPMN 2.0 §10.3.1), so this tab is the only
 * place they are authored and the only place their wires can be made; what
 * declares one also scopes it (§10.4.7). The tab is offered on processes,
 * activities, and events — the three element kinds the standard allows to
 * carry properties — and nowhere else.
 */

test.describe('Inspector execution tab', () => {
  test('declares typed properties that serialize as plain BPMN properties', async ({ page }) => {
    await gotoModeler(page);

    const inspector = page.getByTestId('inspector-root');

    // Empty canvas selects the root: study-scoped state is declared here.
    await inspector.getByRole('tab', { name: 'Execution' }).click();
    // Whether declarations here bound a scope instance is the one thing the
    // rows cannot show, so the section's help carries it.
    await page.getByTestId('state-scope-help').hover();
    await expect(page.getByTestId('state-scope-help-bubble')).toContainText('opens a scope');

    await page.getByTestId('add-property').click();
    await page.getByLabel('Property name (Property_1)').fill('arm');
    await page.getByTestId('property-type-Property_1').click();
    await page.getByRole('option', { name: 'string', exact: true }).click();
    await expect(page.getByTestId('property-type-Property_1')).toHaveValue('string');

    // A second declaration of a different type gets its own item definition.
    await page.getByTestId('add-property').click();
    await page.getByLabel('Property name (Property_2)').fill('failed_trials');
    await page.getByTestId('property-type-Property_2').click();
    await page.getByRole('option', { name: 'integer', exact: true }).click();

    const studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));

    // Declarations land in BPMN's own container, with the item definitions as
    // shared root elements — no studyflow namespace involved in any of it.
    expect(studyflowText).toContain('properties:');
    expect(studyflowText).toContain('name: arm');
    expect(studyflowText).toContain('name: failed_trials');
    expect(studyflowText).toContain('type: bpmn:ItemDefinition');
    expect(studyflowText).toContain('structureRef: string');
    expect(studyflowText).toContain('structureRef: integer');
    expect(studyflowText).toContain('itemSubjectRef: ItemDefinition_string');
    expect(studyflowText).toContain('itemSubjectRef: ItemDefinition_integer');
  });

  test('the tab follows what BPMN allows to carry properties, and edits undo', async ({ page }) => {
    await gotoModeler(page);
    const inspector = page.getByTestId('inspector-root');

    // An activity may carry properties (§10.3.1) but does not open a scope.
    await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
    await inspector.getByRole('tab', { name: 'Execution' }).click();
    await page.getByTestId('state-scope-help').hover();
    await expect(page.getByTestId('state-scope-help-bubble')).toContainText('read through the scope');

    await page.getByTestId('add-property').click();
    await page.getByLabel('Property name (Property_1)').fill('trial_index');
    await expect(page.getByLabel('Property name (Property_1)')).toHaveValue('trial_index');

    // Removing the declaration empties the list again.
    await page.getByRole('button', { name: 'Remove trial_index' }).click();
    await expect(page.getByLabel('Property name (Property_1)')).toHaveCount(0);

    // Each edit is one undo step, so the removal comes back with its name.
    // The keys go to the canvas SVG, which the modeler's keyboard listens on,
    // and the task stays selected — so the Execution tab below is still open.
    await pressOnCanvas(page, 'ControlOrMeta+z');
    await expect(page.getByLabel('Property name (Property_1)')).toHaveValue('trial_index');
  });

  test('types are free text: the diagram\'s own are suggested, new ones are declared', async ({ page }) => {
    await gotoModeler(page);

    // A `structureRef` is any type name, so the picker suggests rather than
    // constrains: this diagram already declares pandas and sklearn types.
    await page.getByTestId('open-file-input').setInputFiles({
      name: 'sklearn_pipeline.png',
      mimeType: 'image/png',
      buffer: readFileSync(path.join(process.cwd(), 'src/assets/examples/sklearn_pipeline.png')),
    });
    await expect(page.locator('g[data-element-id="Cross_Validate"]')).toBeVisible();

    await page.getByTestId('inspector-root').getByRole('tab', { name: 'Execution' }).click();
    await expect(page.getByTestId('property-type-Features')).toHaveValue('pandas.DataFrame');

    // Picking a type the diagram declares reuses its item definition.
    await page.getByTestId('add-property').click();
    await page.getByLabel('Property name (Property_1)').fill('folds');
    await page.getByTestId('property-type-Property_1').click();
    await page.getByRole('option', { name: 'pandas.Series', exact: true }).click();
    await expect(page.getByTestId('property-type-Property_1')).toHaveValue('pandas.Series');

    // A type nothing declares yet is offered as-typed, and declaring it adds
    // one item definition — with an id the XML can carry.
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
      path.join(process.cwd(), 'src/assets/examples/sklearn_pipeline.png'),
    );
    await page.getByTestId('open-file-input').setInputFiles({
      name: 'sklearn_pipeline.png',
      mimeType: 'image/png',
      buffer: source,
    });
    await expect(page.locator('g[data-element-id="Cross_Validate"]')).toBeVisible();

    // The steps lay out in one band along the top, where the floating navbar
    // would swallow the click; pan the canvas down to clear it.
    await page.getByTestId('modeler-canvas').hover();
    await page.mouse.wheel(0, -160);

    // Every input of this step is a declared property, so it has no drawn wire
    // at all. Reading the canvas would report an empty data contract; reading
    // the model reports the real one.
    await page.locator('g[data-element-id="Cross_Validate"]').click();
    await page.getByTestId('inspector-root').getByRole('tab', { name: 'Execution' }).click();

    const dataFlow = page.getByTestId('data-flow-section');
    await expect(dataFlow).toContainText('estimator');
    await expect(dataFlow).toContainText('x_train');
    await expect(dataFlow).toContainText('y_train');
    await expect(dataFlow).toContainText('cv_scores');

    // Each binding is editable in place: the second cell is the callable
    // parameter. `estimator` is blank because it binds by the property's own
    // name; the other two name a different parameter.
    await expect(page.getByLabel('Parameter for x_train')).toHaveValue('X');
    await expect(page.getByLabel('Parameter for y_train')).toHaveValue('y');
    await expect(page.getByLabel('Parameter for estimator')).toHaveValue('');

    // What tells a property row from a drawn one is the row itself, not a
    // word repeated down the column: a property is bound here, so its row
    // edits and unbinds.
    await expect(page.getByRole('button', { name: 'Unbind x_train' })).toBeVisible();

    // A wire to something drawn is made by drawing it, so its row is inert —
    // no parameter box, no unbind — and names its kind on hover.
    await page.locator('g[data-element-id="Summarize_CV"]').click();
    await expect(dataFlow).toContainText('CV fold metrics report → self');
    await expect(page.getByLabel('Parameter for CV fold metrics report')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Unbind CV fold metrics report' })).toHaveCount(0);
    await expect(dataFlow.getByTitle('CV fold metrics report → self (data object)')).toBeVisible();
  });

  test('a property is wired to a step from the inspector, and the wire persists', async ({ page }) => {
    await gotoModeler(page);
    await page.getByTestId('open-file-input').setInputFiles({
      name: 'sklearn_pipeline.png',
      mimeType: 'image/png',
      buffer: readFileSync(path.join(process.cwd(), 'src/assets/examples/sklearn_pipeline.png')),
    });
    await expect(page.locator('g[data-element-id="Build_Pipeline"]')).toBeVisible();
    await page.getByTestId('modeler-canvas').hover();
    await page.mouse.wheel(0, -160);

    await page.locator('g[data-element-id="Build_Pipeline"]').click();
    await page.getByTestId('inspector-root').getByRole('tab', { name: 'Execution' }).click();

    // Only properties in scope are offered, named plainly: the study scope is
    // the default home, so it is not spelled out on every option.
    await page.getByTestId('bind-input').click();
    await expect(page.getByRole('option', { name: 'features', exact: true })).toBeVisible();
    await page.getByRole('option', { name: 'features', exact: true }).click();
    await page.getByLabel('Parameter for features').fill('X');

    const studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
    const lines = studyflowText.split('\n');
    const start = lines.findIndex((l) => l.startsWith('    Build_Pipeline:'));
    let end = start + 1;
    while (end < lines.length && !/^    [A-Za-z_]/.test(lines[end])) end += 1;
    const block = lines.slice(start, end).join('\n');

    // The binding is an ordinary data association on the step, indistinguishable
    // from one drawn on the canvas.
    expect(block).toContain('dataInputAssociations:');
    expect(block).toMatch(/sourceRef:\n\s+- Features/);
    expect(block).toContain('parameter: X');

    // `Wire_Features` is already taken by Select_Features' output wire, and
    // BPMN ids are document-scoped: reusing it would make the two collapse
    // into one on the next parse, losing this binding from the saved file.
    expect(block).not.toMatch(/Wire_Features:\s*$/m);
    expect(studyflowText.match(/Wire_Features:/g) ?? []).toHaveLength(1);
  });

  test('a gateway gets no Execution tab', async ({ page }) => {
    await gotoModeler(page);
    await addPaletteElement(page, 'Gateways', 'Exclusive', { x: 360, y: 200 });

    const inspector = page.getByTestId('inspector-root');
    await expect(inspector.getByRole('tab', { name: 'General' })).toBeVisible();
    await expect(inspector.getByRole('tab', { name: 'Execution' })).toHaveCount(0);
  });
});
