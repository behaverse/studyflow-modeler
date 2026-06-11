import { expect, test } from '@playwright/test';

import { gotoModeler, readDownloadText, runPaletteCommand, uploadStudyflowDiagram } from './utils';

test.describe('Studyflow modeler file flows', () => {
  test('opens a local legacy (BPMN XML) studyflow file', async ({ page }) => {
    await gotoModeler(page);
    // The 'Open File...' command clicks a hidden <input type=file>; set the
    // files on it directly rather than going through the native chooser.
    await uploadStudyflowDiagram(page, 'sample.studyflow');

    await expect(page.getByTitle('Click to edit diagram name')).toHaveText('sample');
    await expect(page.getByTestId('modeler-canvas')).toBeVisible();
  });

  test('downloads the current diagram as a YAML studyflow file', async ({ page }) => {
    await gotoModeler(page);

    const downloadPromise = page.waitForEvent('download');
    await runPaletteCommand(page, 'Save As...', 'Studyflow...');
    const download = await downloadPromise;

    await expect(download.suggestedFilename()).toBe('diagram.studyflow');
    const content = await readDownloadText(download);
    expect(content.startsWith('id:')).toBe(true);
    expect(content).toContain('\ndefinitions:');
    // Geometry folds into the elements; no separate bpmndi tree remains.
    expect(content).not.toContain('\ndiagram:');
    expect(content).toContain('bounds:');
  });

  test('saved YAML studyflow file opens again (UI round trip)', async ({ page }) => {
    await gotoModeler(page);

    const downloadPromise = page.waitForEvent('download');
    await runPaletteCommand(page, 'Save As...', 'Studyflow...');
    const yamlText = await readDownloadText(await downloadPromise);

    await page.locator('input[type="file"]').setInputFiles({
      name: 'roundtrip.studyflow',
      mimeType: 'text/yaml',
      buffer: Buffer.from(yamlText, 'utf8'),
    });

    await expect(page.getByTitle('Click to edit diagram name')).toHaveText('roundtrip');
    await expect(page.getByTestId('modeler-canvas')).toBeVisible();
    // The default diagram's start event survives the YAML round trip.
    await expect(page.locator('.djs-element[data-element-id^="StartEvent"]').first()).toBeVisible();
  });

  test('exports raw BPMN 2.0 XML', async ({ page }) => {
    await gotoModeler(page);

    const downloadPromise = page.waitForEvent('download');
    await runPaletteCommand(page, 'Save As...', 'BPMN 2.0 XML...');
    const download = await downloadPromise;

    await expect(download.suggestedFilename()).toBe('diagram.bpmn');
    const content = await readDownloadText(download);
    expect(content).toContain('<?xml');
    expect(content).toContain('bpmn');
  });
});
