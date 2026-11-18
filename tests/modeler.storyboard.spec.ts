import { expect, test } from './e2e';

import { gotoModeler, runPaletteCommand } from './utils';

/** The participant's storyboard: the session's steps in order (`storyboard/session.ts`, tests/storyboard-session.unit.spec.ts). */

test('the storyboard tells the session as cards in order, a + puts a step between two, and the flow shows it back', async ({ page }) => {
  await gotoModeler(page);
  await runPaletteCommand(page, /^New/);
  await page.getByTestId('example-cognitive_battery').click();
  await expect(page.getByTestId('gallery-dialog')).toBeHidden();

  await page.getByRole('tab', { name: 'Storyboard' }).click();
  const board = page.getByTestId('storyboard');
  const steps = board.locator('[data-step]');
  await expect(steps.first()).toContainText('Participant arrives');
  await expect(steps.nth(2)).toContainText('Working memory (N-Back)');
  const before = await steps.count();

  // A + between two steps opens the Add panel there; the pick lands between them and is selected.
  await board.getByRole('button', { name: 'Add a step before Verbal span (Digit Span)' }).click();
  await page.getByTestId('popup-menu-search').fill('task');
  await page.getByTestId('popup-menu-search').press('Enter');
  await expect(steps).toHaveCount(before + 1);
  await expect(steps.nth(3)).toContainText('Unnamed step');
  await expect(board.getByTestId('inline-inspector')).toBeVisible();

  await page.getByRole('tab', { name: 'Flow' }).click();
  await expect(board).toHaveCount(0);
  await expect(page.locator('g.sf-shape.selected')).toHaveCount(1);
});
