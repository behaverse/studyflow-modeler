import { readFileSync } from 'node:fs';
import path from 'node:path';

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

  test('opens a layout-less studyflow file (auto-layout supplies the DI)', async ({ page }) => {
    await gotoModeler(page);

    // A hand-written file with no BPMN DI. bpmn-js would abort this import with
    // "no diagram to display"; the import path auto-lays it out so it renders.
    await page.getByTestId('open-file-input').setInputFiles({
      name: 'layoutless.studyflow',
      mimeType: 'text/yaml',
      buffer: readFileSync(path.join(process.cwd(), 'tests/fixtures/layoutless.studyflow')),
    });

    await expect(page.getByTitle('Click to edit diagram name')).toHaveText('Layout-less demo');
    // Nodes across the branch — including the boundary event — are drawn.
    await expect(page.locator('.djs-element[data-element-id="Enroll"]')).toBeVisible();
    await expect(page.locator('.djs-element[data-element-id="Eligibility_Gateway"]')).toBeVisible();
    await expect(page.locator('.djs-element[data-element-id="DidNotStart"]')).toBeVisible();
    await expect(page.locator('.djs-element[data-element-id="Done"]')).toBeVisible();
  });

  test('imports a jsPsych timeline JSON via the dedicated command', async ({ page }) => {
    await gotoModeler(page);

    // 'Import jsPsych Timeline...' clicks its own hidden JSON-only <input>;
    // plain 'Open File...' does not accept .json (any JSON could be anything).
    await page.getByTestId('import-jspsych-input').setInputFiles({
      name: 'flanker.timeline.json',
      mimeType: 'application/json',
      buffer: readFileSync(path.join(process.cwd(), 'tests/fixtures/flanker.timeline.json')),
    });

    // The timeline arrives converted: named after the file, one task per node
    // (the leading consent node folds into the start event), chained start -> end.
    await expect(page.getByTitle('Click to edit diagram name')).toHaveText('flanker.timeline');
    await expect(page.locator('.djs-element[data-element-id="Start"]')).toBeVisible();
    await expect(page.locator('.djs-element[data-element-id="Flanker_test"]')).toBeVisible();
    await expect(page.locator('.djs-element[data-element-id="End"]')).toBeVisible();
    await expect(page.locator('.djs-element[data-element-id="Consent"]')).toHaveCount(0);
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

    await page.getByTestId('open-file-input').setInputFiles({
      name: 'roundtrip.studyflow',
      mimeType: 'text/yaml',
      buffer: Buffer.from(yamlText, 'utf8'),
    });

    await expect(page.getByTitle('Click to edit diagram name')).toHaveText('roundtrip');
    await expect(page.getByTestId('modeler-canvas')).toBeVisible();
    // The default diagram's start event survives the YAML round trip.
    await expect(page.locator('.djs-element[data-element-id^="StartEvent"]').first()).toBeVisible();
  });

  test('exported PNG embeds the diagram and opens again (UI round trip)', async ({ page }) => {
    await gotoModeler(page);

    const downloadPromise = page.waitForEvent('download');
    await runPaletteCommand(page, 'Export...', 'PNG...');
    const download = await downloadPromise;
    await expect(download.suggestedFilename()).toBe('diagram.png');

    const filePath = await download.path();
    if (!filePath) throw new Error('Downloaded file path is unavailable.');
    const pngBuffer = readFileSync(filePath);
    // Still a real PNG (the studyflow XML rides in a metadata chunk).
    expect(pngBuffer.subarray(1, 4).toString('ascii')).toBe('PNG');

    await page.getByTestId('open-file-input').setInputFiles({
      name: 'roundtrip.png',
      mimeType: 'image/png',
      buffer: pngBuffer,
    });

    await expect(page.getByTitle('Click to edit diagram name')).toHaveText('roundtrip');
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
