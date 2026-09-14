import { expect, test } from '@playwright/test';

import { addPaletteElement, examplePath, exportDiagram, gotoModeler, pressOnCanvas, readDownloadText } from './utils';

/**
 * The inspector's Execution tab: run state as `bpmn:Property` declarations and the data associations
 * that bind them, repetition, and the language of an expression.
 *
 * A repetition marker's identity is its icon KEY, not its geometry: the canvas resolves glyphs to
 * inline `<svg class="sf-icon">` bodies, and `parallel` and `sequential` share their `<path d>`,
 * differing only by a `rotate(90 …)` wrapper, so a path-based selector would match both.
 */

const LOOP_MARKER = '[data-icon-key="loop"]';
const PARALLEL_MARKER = '[data-icon-key="parallel"]';
const SEQUENTIAL_MARKER = '[data-icon-key="sequential"]';

test('the study declares typed properties, and a step binds one from the picker', async ({ page }) => {
  await gotoModeler(page);
  const inspector = page.getByTestId('inspector-root');
  const openExecutionTab = () => inspector.getByRole('tab', { name: 'Execution' }).click();

  // With nothing selected the inspector shows the study, which opens a scope, so it declares.
  await openExecutionTab();
  await page.getByTestId('state-scope-help').hover();
  await expect(page.getByTestId('state-scope-help-bubble')).toContainText('opens a scope');
  await page.getByTestId('add-property').click();
  await page.getByLabel('Property name (Property_1)').fill('arm');
  // A type is picked from the suggestions, or typed: one the file does not have yet is declared.
  await page.getByTestId('property-type-Property_1').click();
  await page.getByRole('option', { name: 'string', exact: true }).click();
  await expect(page.getByTestId('property-type-Property_1')).toHaveValue('string');
  await page.getByTestId('add-property').click();
  await page.getByLabel('Property name (Property_2)').fill('embeddings');
  await page.getByTestId('property-type-Property_2').fill('torch.Tensor');
  await page.getByRole('option', { name: 'Use torch.Tensor' }).click();
  await expect(page.getByTestId('property-type-Property_2')).toHaveValue('torch.Tensor');

  // A step declares nothing; it binds what its scopes declare.
  await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
  await openExecutionTab();
  await expect(inspector.getByTestId('state-section')).toHaveCount(0);
  await page.getByTestId('bind-input').click();
  await page.getByRole('option', { name: 'arm', exact: true }).click();
  await expect(inspector.getByRole('button', { name: 'Unbind arm' })).toBeVisible();
  await page.getByLabel('Transformation for arm').fill('arm.lower()');

  const studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
  expect(studyflowText).toContain('itemSubjectRef: ItemDefinition_string');
  expect(studyflowText).toContain('itemSubjectRef: ItemDefinition_torch.Tensor');
  expect(studyflowText).toMatch(/DataInput_Property_1:\n\s+sourceRef:\n\s+- Property_1\n/);
  expect(studyflowText).toContain('transformation: arm.lower()');
});

// On a diagram of its own: a container's first property takes `Property_1` even when the study
// already holds one (`nextPropertyId` looks at one scope), and the next import loses one of the two.
test('a container declares its own properties, and removing one is an edit that undoes', async ({ page }) => {
  await gotoModeler(page);
  await addPaletteElement(page, 'Containers', 'Sub-process', { x: 620, y: 400 });
  await page.keyboard.press('Escape');
  await page.getByTestId('inspector-root').getByRole('tab', { name: 'Execution' }).click();

  await page.getByTestId('add-property').click();
  const name = page.getByLabel('Property name (Property_1)');
  await name.fill('trial_index');
  await page.getByRole('button', { name: 'Remove trial_index' }).click();
  await expect(name).toHaveCount(0);
  await pressOnCanvas(page, 'ControlOrMeta+z');
  await expect(name).toHaveValue('trial_index');
});

test('a step repeats: its kind sets the canvas marker, its condition takes a language, and edits undo', async ({ page }) => {
  await gotoModeler(page);
  const canvas = page.getByTestId('modeler-canvas');

  await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
  await page.getByTestId('inspector-root').getByRole('tab', { name: 'Execution' }).click();
  const kind = page.getByTestId('loop-kind');
  await expect(kind).toContainText('None');
  await expect(canvas.locator(LOOP_MARKER)).toHaveCount(0);

  await kind.click();
  await page.getByRole('option', { name: 'Loop (repeat)' }).click();
  await expect(kind).toContainText('Loop (repeat)');
  await expect(canvas.locator(LOOP_MARKER)).toHaveCount(1);

  const section = page.getByTestId('loop-section');
  const condition = section.locator('textarea[name="loopCondition"]');
  await condition.fill('score < 0.9');
  await section.getByLabel('Expression language').selectOption('python');
  await section.locator('input[name="loopMaximum"]').fill('5');
  // The only checkbox in loop mode is testBefore.
  await section.getByRole('checkbox').click();

  await kind.click();
  await page.getByRole('option', { name: 'Parallel (fan out)' }).click();
  await expect(canvas.locator(LOOP_MARKER)).toHaveCount(0);
  await expect(canvas.locator(PARALLEL_MARKER)).toHaveCount(1);

  await kind.click();
  await page.getByRole('option', { name: 'Sequential (fan out)' }).click();
  await expect(canvas.locator(SEQUENTIAL_MARKER)).toHaveCount(1);
  await expect(canvas.locator(PARALLEL_MARKER)).toHaveCount(0);

  await pressOnCanvas(page, 'ControlOrMeta+z');
  await expect(canvas.locator(PARALLEL_MARKER)).toHaveCount(1);
  await pressOnCanvas(page, 'ControlOrMeta+z');
  await expect(canvas.locator(LOOP_MARKER)).toHaveCount(1);
  await expect(kind).toContainText('Loop (repeat)');
  await expect(condition).toHaveValue('score < 0.9');
  await expect(section.locator('input[name="loopMaximum"]')).toHaveValue('5');

  const studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
  expect(studyflowText).toContain('type: StandardLoopCharacteristics');
  expect(studyflowText).toContain('language: python');
});

test('an expression field carries a language select that persists, and emptying it removes the expression', async ({ page }) => {
  await gotoModeler(page);
  await page.getByTestId('open-file-input').setInputFiles(examplePath('drawn_loop'));
  await expect(page.locator('g[data-element-id="Say"]')).toBeVisible();

  await page.locator('g[data-element-id="Again_label"]').click();
  const condition = page.locator('textarea[name="bpmn:conditionExpression"]');
  await expect(condition).toHaveValue("state.trace.count('Gate') < 8");

  // Unprefixed by default, the engine's own language.
  const language = page.getByLabel('Expression language');
  await expect(language).toHaveValue('');
  await language.selectOption('python');
  expect(await readDownloadText(await exportDiagram(page, 'studyflow'))).toContain('language: python');

  // No text, no element: clearing the field removes the expression, so the conditional-flow marker follows.
  await condition.fill('');
  expect(await readDownloadText(await exportDiagram(page, 'bpmn'))).not.toContain('conditionExpression');
});

/** A Behaverse task whose own scene is NB, and a Parameters object wired into it that sets WO; a sub-process with one
 * wired into it too. */
const OVERRIDDEN_SCENE = `id: overridden_scene
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Overridden_Scene:
  type: Process
  flowElements:
    Play:
      type: ChoreographyTask
      name: Play
      extensionElements:
        - type: behaverse:Task
          scene: NB
      dataInputAssociations:
        In_Settings:
          sourceRef:
            - Settings
          waypoint: 320,308 320,258
      bounds: 260 138 120 120
    Settings:
      type: DataObjectReference
      name: WhichOne settings
      extensionElements:
        - type: studyflow:Parameters
          values:
            scene: WO
            Timelines:
              SimonTask: null
      bounds: 302 308 36 50
    Block:
      type: SubProcess
      name: Block
      dataInputAssociations:
        In_Knobs:
          sourceRef:
            - Knobs
          waypoint: 520,308 520,258
      bounds: 470 178 100 80
      isExpanded: false
    Knobs:
      type: DataObjectReference
      name: Knobs
      extensionElements:
        - type: studyflow:Parameters
          values:
            speed: 20
      bounds: 502 308 36 50
`;

test('what the Parameters wired into a step set is shown locked, naming them, and one click selects them', async ({ page }) => {
  await gotoModeler(page);
  await page.getByTestId('open-file-input').setInputFiles({
    name: 'overridden_scene.studyflow.yaml', mimeType: 'text/yaml', buffer: Buffer.from(OVERRIDDEN_SCENE),
  });
  await page.locator('g[data-element-id="Play"]').click();
  const inspector = page.getByTestId('inspector-root');
  await inspector.getByRole('tab', { name: 'Execution' }).click();

  const scene = inspector.locator('input[name$="scene"]');
  await expect(scene).toHaveValue('WO');
  await expect(scene).toBeDisabled();
  await expect(inspector.getByTestId('overridden-scene'))
    .toContainText("Set by WhichOne settings (scene); edit it there, not here. This element's own value, NB, is not used.");

  await inspector.getByRole('button', { name: 'WhichOne settings', exact: true }).click();
  await expect(inspector).toContainText('studyflow:Parameters');

  // Wired into a sub-process, they are its properties, read-only beside the ones it declares.
  await page.locator('g[data-element-id="Block"]').click();
  await inspector.getByRole('tab', { name: 'Execution' }).click();
  await expect(inspector.getByTestId('wired-property-speed')).toContainText('speed20Set by Knobs; read-only inside, edit it there.');
});
