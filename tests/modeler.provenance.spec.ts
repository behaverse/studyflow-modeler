import { expect, test } from '@playwright/test';

import { gotoModeler, pressOnCanvas, runPaletteCommand } from './utils';

/** A study one run has stamped: the run itself on the document, and each step it executed. */
const RUN_STAMPED = `id: run_stamped
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Run_Stamped:
  type: Process
  name: run stamped
  extensionElements:
    - type: studyflow:Study
  flowElements:
    Fit:
      type: Task
      name: fit
      extensionElements:
        - type: prov:Activity
          action: executed
          when: "2026-09-01T10:00:01Z"
          run: demo
      bounds: 100 100 100 80
    Score:
      type: Task
      name: score
      extensionElements:
        - type: prov:Activity
          action: executed
          when: "2026-09-01T10:00:02Z"
          run: demo
      bounds: 300 100 100 80
    Flow_Fit_Score: Fit -> Score
state:
  _meta:
    prov:
      - action: executed
        when: "2026-09-01T10:00:00Z"
        run: demo
        seed: 42
`;

test('the provenance view lists a run\'s records, `p` filters it to the selection, and invalidating a record marks it and undoes', async ({ page }) => {
  await gotoModeler(page);
  await page.getByTestId('open-file-input').setInputFiles({
    name: 'run_stamped.studyflow.yaml', mimeType: 'text/yaml', buffer: Buffer.from(RUN_STAMPED),
  });
  const dialog = page.getByRole('dialog');
  const rows = dialog.getByTestId('provenance-log').getByRole('listitem');

  // From the palette, the whole timeline, oldest first: the run's stamp, then the steps it executed.
  await runPaletteCommand(page, 'View Provenance...');
  await expect(dialog).toContainText('3 entries · 1 run · 1 repository');
  await expect(dialog).toContainText('git -C runs/demo log');
  await expect(rows).toHaveText([/^executed\s*Run_Stamped/, /^executed\s*Fit/, /^executed\s*Score/]);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();

  // `p` on a selected step opens its own records alone.
  await page.locator('g[data-element-id="Fit"]').click();
  await pressOnCanvas(page, 'p');
  await expect(dialog.getByRole('button', { name: 'Clear provenance filter' })).toBeVisible();
  await expect(rows).toHaveText([/^executed\s*Fit/]);

  // Invalidating keeps the record and appends a marker under it, where the next run branches; undo takes it back.
  const invalidate = dialog.getByRole('button', { name: 'Invalidate executed record of Fit' });
  await invalidate.click();
  await expect(rows).toHaveText([/^executed\s*Fit/, /^invalidated\s*Fit\s*branches here/]);
  await expect(invalidate).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Undo' }).click();
  await expect(rows).toHaveText([/^executed\s*Fit/]);
  await expect(invalidate).toBeVisible();
});
