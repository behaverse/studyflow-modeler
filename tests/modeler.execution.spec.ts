import { expect, test } from './e2e';

import { addPaletteElement, exportDiagram, gotoModeler, pressOnCanvas, readDownloadText } from './utils';

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

/** The name field of a declared property, labelled with the property's id. */
const propertyName = (page: import('@playwright/test').Page, id: string) => page.getByRole('textbox', { name: new RegExp(`\\b${id}\\b`) });

test('the study declares typed properties, a step binds one from the picker, and a container declares its own', async ({ page }) => {
  await gotoModeler(page);
  const inspector = page.getByTestId('inspector-root');
  const openExecutionTab = () => inspector.getByRole('tab', { name: /execution/i }).click();

  // With nothing selected the inspector shows the study, which opens a scope, so it declares.
  await openExecutionTab();
  await page.getByTestId('state-scope-help').hover();
  await expect(page.getByTestId('state-scope-help-bubble')).toBeVisible();
  await page.getByTestId('add-property').click();
  await propertyName(page, 'Property_1').fill('arm');
  // A type is picked from the suggestions, or typed: one the file does not have yet is declared.
  await page.getByTestId('property-type-Property_1').click();
  await page.getByRole('option', { name: 'string', exact: true }).click();
  await expect(page.getByTestId('property-type-Property_1')).toHaveValue('string');
  await page.getByTestId('add-property').click();
  await propertyName(page, 'Property_2').fill('embeddings');
  await page.getByTestId('property-type-Property_2').fill('torch.Tensor');
  await page.getByRole('option', { name: /torch\.Tensor/ }).click();
  await expect(page.getByTestId('property-type-Property_2')).toHaveValue('torch.Tensor');

  // A step declares nothing; it binds what its scopes declare.
  await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
  await openExecutionTab();
  await expect(inspector.getByTestId('state-section')).toHaveCount(0);
  await page.getByTestId('bind-input').click();
  await page.getByRole('option', { name: 'arm', exact: true }).click();
  await expect(inspector.getByRole('button', { name: /unbind.*\barm\b/i })).toBeVisible();
  await page.getByLabel(/transformation.*\barm\b/i).fill('lower case(arm)');

  // A container opens a scope, so it declares its own, under an id no other scope holds; removing one is an edit that undoes.
  await addPaletteElement(page, 'Containers', 'Sub-process', { x: 620, y: 400 });
  await page.keyboard.press('Escape');
  await openExecutionTab();
  await page.getByTestId('add-property').click();
  const trialIndex = propertyName(page, 'Property_3');
  await trialIndex.fill('trial_index');
  await page.getByRole('button', { name: /remove.*trial_index/i }).click();
  await expect(trialIndex).toHaveCount(0);
  await pressOnCanvas(page, 'ControlOrMeta+z');
  await expect(trialIndex).toHaveValue('trial_index');

  const studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
  expect(studyflowText).toContain('itemSubjectRef: ItemDefinition_string');
  expect(studyflowText).toContain('itemSubjectRef: ItemDefinition_torch.Tensor');
  expect(studyflowText).toMatch(/DataInput_Property_1:\n\s+sourceRef:\n\s+- Property_1\n/);
  expect(studyflowText).toContain('transformation: lower case(arm)');
});

test('a step repeats: its kind sets the canvas marker, its condition is FEEL and flagged when not, and edits undo', async ({ page }) => {
  await gotoModeler(page);
  const canvas = page.getByTestId('modeler-canvas');

  await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
  await page.getByTestId('inspector-root').getByRole('tab', { name: /execution/i }).click();
  const kind = page.getByTestId('loop-kind');
  await expect(kind).toContainText(/none/i);
  await expect(canvas.locator(LOOP_MARKER)).toHaveCount(0);

  await kind.click();
  await page.getByRole('option', { name: /^loop/i }).click();
  await expect(kind).toContainText(/loop/i);
  await expect(canvas.locator(LOOP_MARKER)).toHaveCount(1);

  const section = page.getByTestId('loop-section');
  const condition = section.locator('textarea[name="loopCondition"]');
  // One language everywhere: the field names it, and marks an expression written in another.
  await expect(section.getByText('FEEL', { exact: true })).toBeVisible();
  await condition.fill("state.trace.count('Gate') < 8");
  await expect(condition).toHaveAttribute('aria-invalid', 'true');
  await condition.fill('score < 0.9');
  await expect(condition).not.toHaveAttribute('aria-invalid', 'true');
  await section.locator('input[name="loopMaximum"]').fill('5');
  // The only checkbox in loop mode is testBefore.
  await section.getByRole('checkbox').click();

  await kind.click();
  await page.getByRole('option', { name: /^parallel/i }).click();
  await expect(canvas.locator(LOOP_MARKER)).toHaveCount(0);
  await expect(canvas.locator(PARALLEL_MARKER)).toHaveCount(1);

  await kind.click();
  await page.getByRole('option', { name: /^sequential/i }).click();
  await expect(canvas.locator(SEQUENTIAL_MARKER)).toHaveCount(1);
  await expect(canvas.locator(PARALLEL_MARKER)).toHaveCount(0);

  await pressOnCanvas(page, 'ControlOrMeta+z');
  await expect(canvas.locator(PARALLEL_MARKER)).toHaveCount(1);
  await pressOnCanvas(page, 'ControlOrMeta+z');
  await expect(canvas.locator(LOOP_MARKER)).toHaveCount(1);
  await expect(kind).toContainText(/loop/i);
  await expect(condition).toHaveValue('score < 0.9');
  await expect(section.locator('input[name="loopMaximum"]')).toHaveValue('5');
});

/** A Behaverse task whose own instrument is NB, and a Parameters object wired into it that sets WO; a sub-process with one
 * wired into it too. */
const OVERRIDDEN_INSTRUMENT = `id: overridden_instrument
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
          instrument: NB
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
            instrument: WO
            timeline: SimonTask
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
    name: 'overridden_instrument.studyflow.yaml', mimeType: 'text/yaml', buffer: Buffer.from(OVERRIDDEN_INSTRUMENT),
  });
  await page.locator('g[data-element-id="Play"]').click();
  const inspector = page.getByTestId('inspector-root');
  await inspector.getByRole('tab', { name: /execution/i }).click();

  const instrument = inspector.locator('input[name$="instrument"]');
  await expect(instrument).toHaveValue('WO');
  await expect(instrument).toBeDisabled();
  // The notice names the object that sets it and the value it overrides; the wording is the UI's.
  const overridden = inspector.getByTestId('overridden-instrument');
  await expect(overridden).toContainText(/WhichOne settings/);
  await expect(overridden).toContainText(/\bNB\b/);
  // The same object sets the timeline, so that field is locked too, naming it.
  await expect(inspector.locator('input[name$="timeline"]')).toHaveValue('SimonTask');
  await expect(inspector.locator('input[name$="timeline"]')).toBeDisabled();

  await inspector.getByRole('button', { name: 'WhichOne settings', exact: true }).first().click();
  await expect(inspector).toContainText('studyflow:Parameters');

  // Wired into a sub-process, they are its properties, read-only beside the ones it declares.
  await page.locator('g[data-element-id="Block"]').click();
  await inspector.getByRole('tab', { name: /execution/i }).click();
  const wired = inspector.getByTestId('wired-property-speed');
  await expect(wired).toContainText('speed');
  await expect(wired).toContainText('20');
  await expect(wired).toContainText(/Knobs/);
});
