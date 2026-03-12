import { expect, test } from '@playwright/test';

import { gotoModeler, openFileMenu, uploadStudyflowDiagram } from './utils';

test.describe('Studyflow modeler file flows', () => {
  test('opens a local studyflow file', async ({ page }) => {
    await gotoModeler(page);
    await openFileMenu(page);
    await uploadStudyflowDiagram(page, 'sample.studyflow');

    await expect(page.getByText('sample', { exact: true })).toBeVisible();
    await expect(page.getByTestId('modeler-canvas')).toBeVisible();
  });

  test('downloads the current diagram as a studyflow file', async ({ page }) => {
    await gotoModeler(page);
    await openFileMenu(page);

    const downloadPromise = page.waitForEvent('download');
    await page.getByText('Save As...', { exact: true }).click();
    const download = await downloadPromise;

    await expect(download.suggestedFilename()).toBe('Untitled Diagram.studyflow');
  });
});