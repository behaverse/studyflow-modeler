import { expect, test } from '@playwright/test';

import { addPaletteElement, gotoModeler } from './utils';

const LOOP_MARKER = '[data-icon-class="iconify mdi--loop"]';
const PARALLEL_MARKER = '[data-icon-class="iconify solar--hamburger-menu-linear rotate-90"]';
const SEQUENTIAL_MARKER = '[data-icon-class="iconify solar--hamburger-menu-linear"]';

test('diagnose full failing sequence', async ({ page }) => {
  await gotoModeler(page);
  await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });

  const dump = async (label: string) => {
    const info = await page.evaluate(() => ({
      task: [...document.querySelectorAll('.djs-element')]
        .map((el) => el.getAttribute('data-element-id') + ' :: ' + el.getAttribute('class'))
        .find((s) => s.includes('Task')),
      directEditing: !!document.querySelector('.djs-direct-editing-content'),
      inspectorTitle: document.querySelector('[data-testid="inspector-root"] h1')?.textContent,
      focused: document.activeElement?.tagName,
    }));
    console.log(`[${label}]`, JSON.stringify(info));
  };

  const inspector = page.getByTestId('inspector-root');
  const canvas = page.getByTestId('modeler-canvas');

  await inspector.getByRole('tab', { name: 'Loop' }).click();
  await dump('loop-tab');

  const kind = page.getByTestId('loop-kind');
  await kind.click();
  await page.getByRole('option', { name: 'Loop (repeat)' }).click();
  await expect(canvas.locator(LOOP_MARKER)).toHaveCount(1);

  const section = page.getByTestId('loop-section');
  await page.locator('input[name="loopCondition"]').fill('score < 0.9');
  await page.locator('input[name="loopMaximum"]').fill('5');
  await section.getByRole('checkbox').click();

  await kind.click();
  await page.getByRole('option', { name: 'Multi-instance (fan out)' }).click();
  await expect(canvas.locator(PARALLEL_MARKER)).toHaveCount(1);
  await section.getByRole('checkbox').click();
  await expect(canvas.locator(SEQUENTIAL_MARKER)).toHaveCount(1);
  await dump('after-edits');

  await canvas.click({ position: { x: 60, y: 60 } });
  await dump('after-blur-click');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(canvas.locator(PARALLEL_MARKER)).toHaveCount(1);
  await dump('after-undo-1');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(canvas.locator(LOOP_MARKER)).toHaveCount(1);
  await dump('after-undo-2');

  await canvas.click({ position: { x: 340, y: 180 } });
  await page.waitForTimeout(400);
  await dump('after-task-click');
});
