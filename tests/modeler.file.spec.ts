import { expect, test } from '@playwright/test';

import { gotoModeler, runPaletteCommand, uploadStudyflowDiagram } from './utils';

test.describe('Studyflow modeler file flows', () => {
  test('opens a local studyflow file', async ({ page }) => {
    await gotoModeler(page);
    // The 'Open File...' command clicks a hidden <input type=file>; set the
    // files on it directly rather than going through the native chooser.
    await uploadStudyflowDiagram(page, 'sample.studyflow');

    await expect(page.getByTitle('Click to edit diagram name')).toHaveText('sample');
    await expect(page.getByTestId('modeler-canvas')).toBeVisible();
  });

  test('downloads the current diagram as a studyflow file', async ({ page }) => {
    await gotoModeler(page);

    const downloadPromise = page.waitForEvent('download');
    await runPaletteCommand(page, 'Save As...');
    const download = await downloadPromise;

    await expect(download.suggestedFilename()).toBe('diagram.studyflow');
  });
});