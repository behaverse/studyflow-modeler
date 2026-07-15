import { expect, test } from '@playwright/test';

import { addPaletteElement, gotoModeler, readDownloadText, runPaletteCommand } from './utils';

/**
 * The inspector's Loop tab: adds/edits/removes BPMN `loopCharacteristics`
 * on an activity, keeps the canvas marker in sync, undoes as one step per
 * edit, and serializes the canonical studyflow YAML shape (see
 * agent_eval.studyflow's Improve and Per_Item nodes).
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

    // None -> standard loop: fields and the ↻ marker appear.
    await kind.click();
    await page.getByRole('option', { name: 'Loop (repeat)' }).click();
    await expect(kind).toContainText('Loop (repeat)');
    await expect(canvas.locator(LOOP_MARKER)).toHaveCount(1);

    const section = page.getByTestId('loop-section');
    await page.locator('input[name="loopCondition"]').fill('score < 0.9');
    await page.locator('input[name="loopMaximum"]').fill('5');
    // The only checkbox in standard mode is testBefore.
    await section.getByRole('checkbox').click();

    // Standard -> multi-instance: ∥ marker, then ≡ once sequential.
    await kind.click();
    await page.getByRole('option', { name: 'Multi-instance (fan out)' }).click();
    await expect(canvas.locator(LOOP_MARKER)).toHaveCount(0);
    await expect(canvas.locator(PARALLEL_MARKER)).toHaveCount(1);

    // The only checkbox in multi-instance mode is isSequential.
    await section.getByRole('checkbox').click();
    await expect(canvas.locator(SEQUENTIAL_MARKER)).toHaveCount(1);
    await expect(canvas.locator(PARALLEL_MARKER)).toHaveCount(0);

    // Undo (one step per edit): sequential -> parallel, then back to standard.
    await canvas.click({ position: { x: 60, y: 60 } });
    await page.keyboard.press('ControlOrMeta+z');
    await expect(canvas.locator(PARALLEL_MARKER)).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(canvas.locator(LOOP_MARKER)).toHaveCount(1);

    // The inspector reflects the undone model when the element is reselected.
    await canvas.click({ position: { x: 340, y: 180 } });
    await inspector.getByRole('tab', { name: 'Loop' }).click();
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
    await page.getByRole('option', { name: 'Loop (repeat)' }).click();
    await expect(canvas.locator(LOOP_MARKER)).toHaveCount(1);

    await kind.click();
    await page.getByRole('option', { name: 'None' }).click();
    await expect(canvas.locator(LOOP_MARKER)).toHaveCount(0);

    const downloadPromise = page.waitForEvent('download');
    await runPaletteCommand(page, 'Save As...', 'Studyflow...');
    const studyflowText = await readDownloadText(await downloadPromise);
    expect(studyflowText).not.toContain('loopCharacteristics');
  });
});
