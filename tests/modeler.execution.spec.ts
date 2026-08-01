import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { addPaletteElement, exportDiagram, gotoModeler, pressOnCanvas, readDownloadText } from './utils';

/**
 * The inspector's Execution tab: `bpmn:Property` declarations, typed by a
 * shared `bpmn:ItemDefinition`, above the data associations that connect them
 * into the step.
 *
 * Properties are never drawn (BPMN 2.0 §10.3.1), so this tab is the only
 * place they are authored and the only place their associations can be made; what
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

  test('declaring is the scope\'s act: containers get the list, steps bind, and edits undo', async ({ page }) => {
    await gotoModeler(page);
    const inspector = page.getByTestId('inspector-root');

    // A leaf activity may carry properties in BPMN (§10.3.1), but nobody else
    // could read one (§10.4.7) — so a task offers no declaration list; it
    // binds what enclosing scopes declare from the data-flow pickers instead.
    await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
    await inspector.getByRole('tab', { name: 'Execution' }).click();
    await expect(inspector.getByRole('button', { name: 'Repeats' })).toBeVisible();
    await expect(inspector.getByTestId('state-section')).toHaveCount(0);

    // A sub-process opens a scope, so it declares.
    await addPaletteElement(page, 'Containers', 'SubProcess', { x: 620, y: 400 });
    await page.keyboard.press('Escape');
    await inspector.getByRole('tab', { name: 'Execution' }).click();
    await page.getByTestId('state-scope-help').hover();
    await expect(page.getByTestId('state-scope-help-bubble')).toContainText('opens a scope');

    await page.getByTestId('add-property').click();
    await page.getByLabel('Property name (Property_1)').fill('trial_index');
    await expect(page.getByLabel('Property name (Property_1)')).toHaveValue('trial_index');

    // Removing the declaration empties the list again.
    await page.getByRole('button', { name: 'Remove trial_index' }).click();
    await expect(page.getByLabel('Property name (Property_1)')).toHaveCount(0);

    // Each edit is one undo step, so the removal comes back with its name.
    // The keys go to the canvas SVG, which the modeler's keyboard listens on,
    // and the sub-process stays selected — so the Execution tab below is still open.
    await pressOnCanvas(page, 'ControlOrMeta+z');
    await expect(page.getByLabel('Property name (Property_1)')).toHaveValue('trial_index');
  });

  test('types are free text: the diagram\'s own are suggested, new ones are declared', async ({ page }) => {
    await gotoModeler(page);

    // A `structureRef` is any type name, so the picker suggests rather than
    // constrains: this diagram already declares pandas and sklearn types.
    await page.getByTestId('open-file-input').setInputFiles({
      name: 'sklearn_pipeline.studyflow.png',
      mimeType: 'image/png',
      buffer: readFileSync(path.join(process.cwd(), 'src/assets/examples/sklearn_pipeline.studyflow.png')),
    });
    // The example's phases are collapsed sub-processes, so most steps live on
    // planes of their own; the `Select` phase shape is on the root plane, and
    // its appearance is the imported-and-rendered signal.
    await expect(page.locator('g[data-element-id="Select"]')).toBeVisible();

    await page.getByTestId('inspector-root').getByRole('tab', { name: 'Execution' }).click();
    // Read on the process, so it has to be one the process declares: the split
    // parts cross phases, while `features` is scoped to `Prepare Data`.
    await expect(page.getByTestId('property-type-X_Train')).toHaveValue('pandas.DataFrame');

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
      path.join(process.cwd(), 'src/assets/examples/sklearn_pipeline.studyflow.png'),
    );
    await page.getByTestId('open-file-input').setInputFiles({
      name: 'sklearn_pipeline.studyflow.png',
      mimeType: 'image/png',
      buffer: source,
    });
    await expect(page.locator('g[data-element-id="Select"]')).toBeVisible();

    // `Cross_Validate` sits inside the collapsed `Select Model` phase, which
    // DI gives a plane of its own — drill down to it through the shape's own
    // affordance, as a reader would.
    await page.getByTitle('Open Select Model').click();
    await expect(page.locator('g[data-element-id="Cross_Validate"]')).toBeVisible();

    // Every input of this step is a declared property, so it has no drawn edge
    // at all. Reading the canvas would report an empty data contract; reading
    // the model reports the real one.
    await page.locator('g[data-element-id="Cross_Validate"]').click();
    await page.getByTestId('inspector-root').getByRole('tab', { name: 'Execution' }).click();

    // The two directions are separate sections, with the step's own
    // declarations between them, so the tab reads as the call's shape.
    const inputs = page.getByTestId('data-flow-inputs');
    const outputs = page.getByTestId('data-flow-outputs');
    await expect(inputs).toContainText('estimator');
    await expect(inputs).toContainText('x_train');
    await expect(inputs).toContainText('y_train');
    await expect(outputs).toContainText('cv_scores');

    // Each binding is editable in place: the transformation cell carries the
    // assignment's editable half (`slot = selection`, each half optional).
    // `estimator` is blank because it binds by the property's own name; the
    // other two name a different callable parameter.
    await expect(page.getByLabel('Transformation for x_train')).toHaveValue('X');
    await expect(page.getByLabel('Transformation for y_train')).toHaveValue('y');
    await expect(page.getByLabel('Transformation for estimator')).toHaveValue('');

    // What tells a property row from a drawn one is the row itself, not a
    // word repeated down the column: a property is bound here, so its row
    // edits and unbinds.
    await expect(page.getByRole('button', { name: 'Unbind x_train' })).toBeVisible();

    // A data association to something drawn is made by drawing it, so its row is inert —
    // no transformation box, no unbind — and names its kind on hover.
    await page.locator('g[data-element-id="Summarize_CV"]').click();
    await expect(inputs).toContainText('self = CV fold metrics');
    await expect(page.getByLabel('Transformation for CV fold metrics')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Unbind CV fold metrics' })).toHaveCount(0);
    await expect(inputs.getByTitle('self = CV fold metrics (data object)')).toBeVisible();
  });

  test('a property is associated with a step from the inspector, and the association persists', async ({ page }) => {
    await gotoModeler(page);
    await page.getByTestId('open-file-input').setInputFiles({
      name: 'sklearn_pipeline.studyflow.png',
      mimeType: 'image/png',
      buffer: readFileSync(path.join(process.cwd(), 'src/assets/examples/sklearn_pipeline.studyflow.png')),
    });
    await expect(page.locator('g[data-element-id="Select"]')).toBeVisible();

    // `Build_Pipeline` is a step of the collapsed `Select Model` phase, drawn
    // on that sub-process's own plane — drill down before looking for it.
    await page.getByTitle('Open Select Model').click();
    await expect(page.locator('g[data-element-id="Build_Pipeline"]')).toBeVisible();

    await page.locator('g[data-element-id="Build_Pipeline"]').click();
    await page.getByTestId('inspector-root').getByRole('tab', { name: 'Execution' }).click();

    // Only properties in scope are offered, named plainly: the study scope is
    // the default home, so it is not spelled out on every option.
    await page.getByTestId('bind-input').click();
    await expect(page.getByRole('option', { name: 'x_train', exact: true })).toBeVisible();

    // And scope really bounds the list. This step is in `Select Model`, so
    // `features` — declared by `Prepare Data`, discarded when that phase
    // ended — is not something it could read (BPMN 2.0 §10.4.7).
    await expect(page.getByRole('option', { name: 'features', exact: true })).toHaveCount(0);

    await page.getByRole('option', { name: 'x_train', exact: true }).click();
    await page.getByLabel('Transformation for x_train').fill('X');

    const studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
    // Found by its own key at whatever depth it sits, and delimited by
    // indentation: the step lives inside a phase sub-process, and how deeply
    // the example nests it is not what this is testing.
    const lines = studyflowText.split('\n');
    const start = lines.findIndex((l) => /^\s+Build_Pipeline:\s*$/.test(l));
    expect(start, 'the exported YAML declares Build_Pipeline').toBeGreaterThan(-1);
    const depth = lines[start].search(/\S/);
    let end = start + 1;
    while (end < lines.length && (lines[end].trim() === '' || lines[end].search(/\S/) > depth)) end += 1;
    const block = lines.slice(start, end).join('\n');

    // The binding is an ordinary data association on the step, indistinguishable
    // from one drawn on the canvas.
    expect(block).toContain('dataInputAssociations:');
    expect(block).toMatch(/sourceRef:\n\s+- X_Train/);
    expect(block).toContain('transformation: X');

    // The id names the BPMN type it creates, so this input association cannot
    // collide with the output association that already produces `x_train` —
    // `DataOutput_X_Train`. It has to be unique either way: BPMN ids are
    // document-scoped, and two associations sharing one collapse into a single
    // element on the next parse, losing this binding from the saved file.
    expect(studyflowText.match(/DataInput_X_Train:/g) ?? []).toHaveLength(1);
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
