import { expect, test } from '@playwright/test';

import { addPaletteElement, exportDiagram, gotoModeler, pressOnCanvas, readDownloadText } from './utils';

/**
 * Repetition, in the inspector's Execution tab: one selector over BPMN's own four repetition
 * states (none / loop ↻ / parallel ∥ / sequential ≡), stored as the
 * activity's `loopCharacteristics` child. It keeps the canvas marker in
 * sync, undoes as one step per edit, and serializes the canonical studyflow
 * YAML shape (see kitchensink.studyflow's Fn_Retry and Fn_ForEach nodes).
 * A repeat spanning several steps is drawn control flow instead.
 */

const LOOP_MARKER = '[data-icon-class="iconify mdi--loop"]';
const PARALLEL_MARKER = '[data-icon-class="iconify solar--hamburger-menu-linear rotate-90"]';
const SEQUENTIAL_MARKER = '[data-icon-class="iconify solar--hamburger-menu-linear"]';

test.describe('Inspector repetition controls', () => {
  test('edits loopCharacteristics with live canvas markers, undo, and YAML round-trip', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
    await expect(page.getByTestId('inspector-root')).toContainText('Task');

    const inspector = page.getByTestId('inspector-root');
    const canvas = page.getByTestId('modeler-canvas');

    // How often a step runs is part of how it runs, so this shares the tab
    // with the function, the associations, and the properties. Only an activity
    // repeats: on anything else the selector is absent, not empty.
    await inspector.getByRole('tab', { name: 'Execution' }).click();
    const kind = page.getByTestId('loop-kind');
    await expect(kind).toContainText('None');
    await expect(canvas.locator(LOOP_MARKER)).toHaveCount(0);

    // None -> loop: fields and the ↻ marker appear.
    await kind.click();
    await page.getByRole('option', { name: 'Loop (repeat)' }).click();
    await expect(kind).toContainText('Loop (repeat)');
    await expect(canvas.locator(LOOP_MARKER)).toHaveCount(1);

    const section = page.getByTestId('loop-section');
    await page.locator('input[name="loopCondition"]').fill('score < 0.9');
    await page.locator('input[name="loopMaximum"]').fill('5');
    // The only checkbox in loop mode is testBefore.
    await section.getByRole('checkbox').click();

    // Loop -> parallel fan-out: ∥ marker.
    await kind.click();
    await page.getByRole('option', { name: 'Parallel (fan out)' }).click();
    await expect(canvas.locator(LOOP_MARKER)).toHaveCount(0);
    await expect(canvas.locator(PARALLEL_MARKER)).toHaveCount(1);

    // Parallel -> sequential: same child, ≡ marker (no checkbox involved).
    await kind.click();
    await page.getByRole('option', { name: 'Sequential (fan out)' }).click();
    await expect(canvas.locator(SEQUENTIAL_MARKER)).toHaveCount(1);
    await expect(canvas.locator(PARALLEL_MARKER)).toHaveCount(0);

    // Undo (one step per edit): sequential -> parallel, then back to loop.
    // The keys go to the canvas SVG, which the modeler's keyboard listens on,
    // and the task stays selected — so the Loop tab below is still the one open.
    await pressOnCanvas(page, 'ControlOrMeta+z');
    await expect(canvas.locator(PARALLEL_MARKER)).toHaveCount(1);
    await pressOnCanvas(page, 'ControlOrMeta+z');
    await expect(canvas.locator(LOOP_MARKER)).toHaveCount(1);

    // The still-open Loop tab reflects the undone model.
    await expect(page.getByTestId('loop-kind')).toContainText('Loop (repeat)');
    await expect(page.locator('input[name="loopCondition"]')).toHaveValue('score < 0.9');
    await expect(page.locator('input[name="loopMaximum"]')).toHaveValue('5');

    // Saved YAML carries the canonical nested shape.
    const studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
    expect(studyflowText).toContain('loopCharacteristics:');
    expect(studyflowText).toContain('type: bpmn:StandardLoopCharacteristics');
    expect(studyflowText).toContain('loopCondition: score < 0.9');
    expect(studyflowText).toContain('loopMaximum: 5');
    expect(studyflowText).toContain('testBefore: true');
  });

  test('removing the loop clears the marker and the serialized child', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
    await page.getByTestId('inspector-root').getByRole('tab', { name: 'Execution' }).click();

    const canvas = page.getByTestId('modeler-canvas');
    const kind = page.getByTestId('loop-kind');

    await kind.click();
    await page.getByRole('option', { name: 'Sequential (fan out)' }).click();
    await expect(canvas.locator(SEQUENTIAL_MARKER)).toHaveCount(1);

    await kind.click();
    await page.getByRole('option', { name: 'None' }).click();
    await expect(canvas.locator(SEQUENTIAL_MARKER)).toHaveCount(0);

    const studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
    expect(studyflowText).not.toContain('loopCharacteristics');
  });
});
