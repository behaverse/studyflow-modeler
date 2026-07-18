import { expect, test } from '@playwright/test';

import { addPaletteElement, gotoModeler, readDownloadText, runPaletteCommand } from './utils';

/**
 * The inspector's Loop tab: one selector over BPMN's own four repetition
 * states (none / loop ↻ / parallel ∥ / sequential ≡), stored as the
 * activity's `loopCharacteristics` child. It keeps the canvas marker in
 * sync, undoes as one step per edit, and serializes the canonical studyflow
 * YAML shape (see kitchensink.studyflow's Fn_Retry and Fn_ForEach nodes).
 * A repeat spanning several steps is drawn control flow instead.
 */

const LOOP_MARKER = '[data-icon-class="iconify mdi--loop"]';
const PARALLEL_MARKER = '[data-icon-class="iconify solar--hamburger-menu-linear rotate-90"]';
const SEQUENTIAL_MARKER = '[data-icon-class="iconify solar--hamburger-menu-linear"]';

test.describe('Inspector loop tab', () => {
  test('edits loopCharacteristics with live canvas markers, undo, and YAML round-trip', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
    await expect(page.getByTestId('inspector-root')).toContainText('Task');

    const inspector = page.getByTestId('inspector-root');
    const canvas = page.getByTestId('modeler-canvas');

    // Events don't get a Loop tab; activities do.
    await inspector.getByRole('tab', { name: 'Loop' }).click();
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
    // The empty-canvas click moves focus off the inspector inputs so the undo
    // keys reach the modeler; the selection (and inspector) stay on the task.
    await canvas.click({ position: { x: 60, y: 60 } });
    await page.keyboard.press('ControlOrMeta+z');
    await expect(canvas.locator(PARALLEL_MARKER)).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(canvas.locator(LOOP_MARKER)).toHaveCount(1);

    // The still-open Loop tab reflects the undone model.
    await expect(page.getByTestId('loop-kind')).toContainText('Loop (repeat)');
    await expect(page.locator('input[name="loopCondition"]')).toHaveValue('score < 0.9');
    await expect(page.locator('input[name="loopMaximum"]')).toHaveValue('5');

    // Saved YAML carries the canonical nested shape.
    const downloadPromise = page.waitForEvent('download');
    await runPaletteCommand(page, 'Save As...', 'Studyflow...');
    const studyflowText = await readDownloadText(await downloadPromise);
    expect(studyflowText).toContain('loopCharacteristics:');
    expect(studyflowText).toContain('type: bpmn:StandardLoopCharacteristics');
    expect(studyflowText).toContain('loopCondition: score < 0.9');
    expect(studyflowText).toContain('loopMaximum: 5');
    expect(studyflowText).toContain('testBefore: true');
  });

  test('removing the loop clears the marker and the serialized child', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
    await page.getByTestId('inspector-root').getByRole('tab', { name: 'Loop' }).click();

    const canvas = page.getByTestId('modeler-canvas');
    const kind = page.getByTestId('loop-kind');

    await kind.click();
    await page.getByRole('option', { name: 'Sequential (fan out)' }).click();
    await expect(canvas.locator(SEQUENTIAL_MARKER)).toHaveCount(1);

    await kind.click();
    await page.getByRole('option', { name: 'None' }).click();
    await expect(canvas.locator(SEQUENTIAL_MARKER)).toHaveCount(0);

    const downloadPromise = page.waitForEvent('download');
    await runPaletteCommand(page, 'Save As...', 'Studyflow...');
    const studyflowText = await readDownloadText(await downloadPromise);
    expect(studyflowText).not.toContain('loopCharacteristics');
  });
});
