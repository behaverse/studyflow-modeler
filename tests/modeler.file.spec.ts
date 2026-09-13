import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { exportDiagram, gotoModeler, readDownloadText } from './utils';

test.describe('Studyflow modeler file flows', () => {
  test('opening a file says what its reading could not place', async ({ page }) => {
    await page.clock.install();
    await gotoModeler(page);

    // No schema declares `studyflow:retired`: the reader drops it, so the next save would too.
    await page.getByTestId('open-file-input').setInputFiles({
      name: 'retired.bpmn',
      mimeType: 'application/xml',
      buffer: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" id="Retired" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Study">
    <bpmn:startEvent id="Start">
      <bpmn:extensionElements><studyflow:retired /></bpmn:extensionElements>
    </bpmn:startEvent>
  </bpmn:process>
</bpmn:definitions>`),
    });

    await expect(page.locator('[data-element-id="Start"]')).toBeVisible();
    await expect(page.getByTestId('notices')).toContainText('Reading retired.bpmn raised warnings:');
    await expect(page.getByTestId('notices')).toContainText('unparsable content <studyflow:retired>');

    // Past the time a warning clears itself: this one names what the next save drops, so it waits to be dismissed.
    await page.clock.fastForward(10_000);
    await expect(page.getByTestId('notices')).toContainText('Reading retired.bpmn raised warnings:');
  });

  test('opens a layout-less studyflow file (auto-layout supplies the DI)', async ({ page }) => {
    await gotoModeler(page);

    // No BPMN DI: bpmn-js alone would abort with "no diagram to display"; the import path auto-lays it out.
    await page.getByTestId('open-file-input').setInputFiles({
      name: 'layoutless.studyflow',
      mimeType: 'text/yaml',
      buffer: readFileSync(path.join(process.cwd(), 'tests/fixtures/layoutless.studyflow')),
    });

    await expect(page.getByTitle('Click to edit diagram name')).toHaveText('Layout-less demo');
    await expect(page.locator('[data-element-id="Enroll"]')).toBeVisible();
    await expect(page.locator('[data-element-id="Eligibility_Gateway"]')).toBeVisible();
    await expect(page.locator('[data-element-id="DidNotStart"]')).toBeVisible();
    await expect(page.locator('[data-element-id="Done"]')).toBeVisible();
  });

  test('opens a jsPsych timeline JSON, converting it on the way in', async ({ page }) => {
    await gotoModeler(page);

    // No separate importer: 'Open File...' takes a timeline and converts it on the way in.
    await page.getByTestId('open-file-input').setInputFiles({
      name: 'flanker.timeline.json',
      mimeType: 'application/json',
      buffer: readFileSync(path.join(process.cwd(), 'skills/jspsych/tests/fixtures/flanker.timeline.json')),
    });

    await expect(page.getByTitle('Click to edit diagram name')).toHaveText('flanker.timeline');
    await expect(page.locator('[data-element-id="Start"]')).toBeVisible();
    await expect(page.locator('[data-element-id="Flanker_test"]')).toBeVisible();
    await expect(page.locator('[data-element-id="End"]')).toBeVisible();
    await expect(page.locator('[data-element-id="Consent"]')).toHaveCount(0);
  });

  test('downloads the current diagram as a YAML studyflow file', async ({ page }) => {
    await gotoModeler(page);

    const download = await exportDiagram(page, 'studyflow');

    await expect(download.suggestedFilename()).toBe('diagram.studyflow.yaml');
    const content = await readDownloadText(download);
    expect(content.startsWith('id:')).toBe(true);
    expect(content).toContain('\ndefinitions:');
    expect(content).not.toContain('\ndiagram:');
    expect(content).toContain('bounds:');
    // The export stamp lands in the run state's `_meta.prov` list, lifted to the top-level `state:` key.
    expect(content).toContain('\nstate:');
    expect(content).toContain('_meta:');
    expect(content).toContain('prov:');
    expect(content).toContain('action: created');
  });

  test('saved YAML studyflow file opens again (UI round trip)', async ({ page }) => {
    await gotoModeler(page);

    const yamlText = await readDownloadText(await exportDiagram(page, 'studyflow'));

    await page.getByTestId('open-file-input').setInputFiles({
      name: 'roundtrip.studyflow',
      mimeType: 'text/yaml',
      buffer: Buffer.from(yamlText, 'utf8'),
    });

    await expect(page.getByTitle('Click to edit diagram name')).toHaveText('roundtrip');
    await expect(page.getByTestId('modeler-canvas')).toBeVisible();
    await expect(page.locator('[data-element-id^="StartEvent"]').first()).toBeVisible();
  });

  test('exported PNG embeds the diagram and opens again (UI round trip)', async ({ page }) => {
    await gotoModeler(page);

    const download = await exportDiagram(page, 'png');
    await expect(download.suggestedFilename()).toBe('diagram.studyflow.png');

    const filePath = await download.path();
    if (!filePath) throw new Error('Downloaded file path is unavailable.');
    const pngBuffer = readFileSync(filePath);
    expect(pngBuffer.subarray(1, 4).toString('ascii')).toBe('PNG');

    await page.getByTestId('open-file-input').setInputFiles({
      name: 'roundtrip.png',
      mimeType: 'image/png',
      buffer: pngBuffer,
    });

    await expect(page.getByTitle('Click to edit diagram name')).toHaveText('roundtrip');
    await expect(page.locator('[data-element-id^="StartEvent"]').first()).toBeVisible();
  });

  test('the rasterizer pads the figure, so nothing at the edge is clipped', async ({ page }) => {
    await gotoModeler(page);

    // bpmn-js exports the tight bounding box, which clips stroke halves, arrowheads, and overhanging labels.
    const result = await page.evaluate(async () => {
      // Compiler-visible test hook (src/modeler/testHooks.ts): renaming the export fails the build, not this test.
      const mod = window.__studyflowTest!;
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" '
        + 'viewBox="412 240 36 36"><rect x="412" y="240" width="36" height="36" fill="black"/></svg>';
      const url = await mod.exportToPng(svg);
      const image = new Image();
      await new Promise((resolve) => {
        image.onload = resolve;
        image.src = url;
      });
      return { root: mod.padSvg(svg).match(/<svg[^>]*>/)?.[0], width: image.width, height: image.height };
    });

    // The box moves out by the margin and grows by twice it, so the drawing keeps scale and gains a border.
    expect(result.root).toContain('viewBox="404 232 52 52"');
    expect(result.root).toContain('width="52"');
    expect(result.root).toContain('height="52"');
    expect(result.width).toBe(52);
    expect(result.height).toBe(52);
  });

  test('exports a standalone draw.io file', async ({ page }) => {
    await gotoModeler(page);

    const download = await exportDiagram(page, 'drawio');

    expect(download.suggestedFilename()).toBe('diagram.drawio');
    const content = await readDownloadText(download);
    expect(content).toContain('<mxfile host="studyflow-modeler">');
    expect(content).toMatch(/<mxCell id="StartEvent[^"]*"[^>]*shape=mxgraph\.bpmn\.event/);
  });
});
