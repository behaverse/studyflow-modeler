import { expect, test } from '@playwright/test';

import { addPaletteElement, exportDiagram, gotoModeler, pressOnCanvas, readDownloadText } from './utils';

/**
 * One selector over BPMN's four repetition states, kept in sync with the canvas marker and the saved YAML.
 *
 * The marker's identity is its icon KEY, not its geometry: since the canvas resolves
 * glyphs to inline `<svg class="sf-icon">` bodies, `parallel` and `sequential` share
 * their `<path d>` verbatim and differ only by a `rotate(90 …)` wrapper — a
 * path-based selector would match both and these assertions would pass vacuously.
 */

const LOOP_MARKER = '[data-icon-key="loop"]';
const PARALLEL_MARKER = '[data-icon-key="parallel"]';
const SEQUENTIAL_MARKER = '[data-icon-key="sequential"]';

test.describe('Inspector repetition controls', () => {
  test('edits loopCharacteristics with live canvas markers, undo, and YAML round-trip', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
    await expect(page.getByTestId('inspector-root')).toContainText('Task');

    const inspector = page.getByTestId('inspector-root');
    const canvas = page.getByTestId('modeler-canvas');

    await inspector.getByRole('tab', { name: 'Execution' }).click();
    const kind = page.getByTestId('loop-kind');
    await expect(kind).toContainText('None');
    await expect(canvas.locator(LOOP_MARKER)).toHaveCount(0);

    await kind.click();
    await page.getByRole('option', { name: 'Loop (repeat)' }).click();
    await expect(kind).toContainText('Loop (repeat)');
    await expect(canvas.locator(LOOP_MARKER)).toHaveCount(1);

    const section = page.getByTestId('loop-section');
    await page.locator('textarea[name="loopCondition"]').fill('score < 0.9');
    await page.locator('input[name="loopMaximum"]').fill('5');
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

    await expect(page.getByTestId('loop-kind')).toContainText('Loop (repeat)');
    await expect(page.locator('textarea[name="loopCondition"]')).toHaveValue('score < 0.9');
    await expect(page.locator('input[name="loopMaximum"]')).toHaveValue('5');

    const studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
    expect(studyflowText).toContain('loopCharacteristics:');
    expect(studyflowText).toContain('type: StandardLoopCharacteristics');
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
