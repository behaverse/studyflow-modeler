import { expect, test } from './e2e';

import { diagramTitle, examplePath, gotoModeler, runPaletteCommand } from './utils';

/** The Gantt view on a scheduled study: what it draws is laid out by gantt/rows.ts (tests/gantt-rows.unit.spec.ts). */

test('the Gantt view draws a scheduled study as a row per step and group under one axis, joins a step to what it waits on, and a group folds its rows away and back', async ({ page }) => {
  await gotoModeler(page);
  await page.getByTestId('open-file-input').setInputFiles(examplePath('spirit2025'));
  await expect(diagramTitle(page)).toHaveText('SPIRIT 2025 trial protocol');
  await runPaletteCommand(page, /gantt/i);

  const chart = page.locator('svg[aria-label="Gantt chart"]');
  const rows = chart.locator('foreignObject [title]');
  const arrow = (text: string) => chart.locator('path[marker-end] > title', { hasText: text });
  const FOLLOW_UP = ['Outcome assessment', 'Adverse-event review', 'Adherence check'];

  // A group (the pool, a lane, a sub-process) heads the rows it holds; a lane with nothing scheduled has no row.
  await expect(rows).toHaveText([
    'SPIRIT 2025 trial protocol', 'Enrolment', 'Recruitment', 'Screening visit (t = -t1)', 'Baseline visit (t = 0)',
    'Post-allocation', 'Intervention: cognitive training', 'Control: active sham',
    'Follow-up visit (t = t1, week 4)', ...FOLLOW_UP, 'Primary endpoint visit (t = t2, week 12)',
    'Close-out', 'Close-out (t = tx, week 24)',
  ]);
  // One axis in weeks from T0 under every row, and a bar wide enough shows its progress.
  for (const tick of ['T0', '+12 w', '+24 w']) await expect(chart.getByText(tick, { exact: true })).toBeVisible();
  await expect(chart.getByText('60%', { exact: true }).first()).toBeVisible();
  // An arrow joins a step to the step it waits on, inside a group and across groups.
  await expect(arrow('Adverse-event review after Outcome assessment')).toHaveCount(1);
  await expect(arrow('Follow-up visit (t = t1, week 4) after Intervention: cognitive training')).toHaveCount(1);

  // Folded, a group keeps its own row and the arrows that leave it; its rows, and the arrows between them, go.
  const caret = rows.filter({ hasText: 'Follow-up visit' }).getByRole('button');
  await caret.click();
  await expect(caret).toHaveAttribute('aria-expanded', 'false');
  for (const label of FOLLOW_UP) await expect(rows.filter({ hasText: label })).toHaveCount(0);
  await expect(arrow('Adverse-event review after Outcome assessment')).toHaveCount(0);
  await expect(arrow('Primary endpoint visit (t = t2, week 12) after Follow-up visit (t = t1, week 4)')).toHaveCount(1);

  await caret.click();
  await expect(caret).toHaveAttribute('aria-expanded', 'true');
  for (const label of FOLLOW_UP) await expect(rows.filter({ hasText: label })).toHaveCount(1);
});
