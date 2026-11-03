import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './e2e';

import { extractStudyflowFromTiff, pngSize, tiffResolution, tiffSize } from '@core/document';

import { diagramTitle, exportDiagram, gotoModeler, readDownload, readDownloadText, runPaletteCommand } from './utils';

test('exports YAML, PNG, SVG, TIFF and LinkML; opens a layout-less file, a jsPsych timeline, the exports again, and says what a file\'s reading could not place', async ({ page }) => {
  // A clock the test runs forward, installed before the page loads, for the warning at the end.
  await page.clock.install();
  await gotoModeler(page);
  const open = page.getByTestId('open-file-input');
  const title = diagramTitle(page);

  // A download is an export, so the YAML carries the trail's first stamp.
  const yaml = await exportDiagram(page, 'studyflow');
  expect(yaml.suggestedFilename()).toBe('diagram.studyflow.yaml');
  const yamlText = await readDownloadText(yaml);
  expect(yamlText).toContain('action: created');
  const png = await exportDiagram(page, 'png');
  expect(png.suggestedFilename()).toBe('diagram.studyflow.png');
  const pngBytes = await readDownload(png);
  const svg = await exportDiagram(page, 'svg');
  expect(svg.suggestedFilename()).toBe('diagram.studyflow.svg');
  const svgText = await readDownloadText(svg);
  // A TIFF is asked its size on paper: the figure's own width at 0.2 mm a unit, at 300 dpi, unless typed over.
  const tif = await exportDiagram(page, 'tif', async () => {
    const width = page.getByTestId('export-print-width');
    const units = Number(await width.getAttribute('data-units'));
    expect(units).toBe(pngSize(pngBytes).width);
    expect(Number(await width.inputValue())).toBeCloseTo(units * 0.2, 1);
    await expect(page.getByTestId('export-print-dpi')).toHaveValue('300');
    await width.fill('50');
    await page.getByTestId('export-print-dpi').fill('100');
    await expect(page.getByTestId('export-print-pixels')).toHaveText(/^197 × \d+ px$/);
  });
  expect(tif.suggestedFilename()).toBe('diagram.studyflow.tif');
  const tifBytes = new Uint8Array(await readDownload(tif));
  expect(tiffSize(tifBytes).width).toBe(197);
  expect(tiffResolution(tifBytes)).toEqual({ x: 100, y: 100 });
  expect(extractStudyflowFromTiff(tifBytes)).toContain('schemas:');
  // A skill's export is one more format in Save As; the figures a manuscript takes are in its own view.
  const linkml = await exportDiagram(page, 'linkml');
  expect(linkml.suggestedFilename()).toBe('diagram.linkml.yaml');
  expect(await readDownloadText(linkml)).toContain('behaverse.org/schemas/studyflow');

  // No diagram interchange, and the canvas never lays out: import lays the file out first.
  await open.setInputFiles({
    name: 'layoutless.studyflow',
    mimeType: 'text/yaml',
    buffer: readFileSync(path.join(process.cwd(), 'tests/fixtures/layoutless.studyflow')),
  });
  await expect(title).toHaveText('Layout-less demo');
  for (const id of ['Enroll', 'Eligibility_Gateway', 'DidNotStart', 'Done']) {
    await expect(page.locator(`[data-element-id="${id}"]`), id).toBeVisible();
  }

  // A skill's opener takes a file of its own: a jsPsych timeline is converted on the way in.
  await open.setInputFiles({
    name: 'flanker.timeline.json',
    mimeType: 'application/json',
    buffer: readFileSync(path.join(process.cwd(), 'skills/jspsych/tests/fixtures/flanker.timeline.json')),
  });
  await expect(title).toHaveText('flanker.timeline');
  await expect(page.locator('[data-element-id="Flanker_test"]')).toBeVisible();

  // The exports reopen as the diagram they were made from.
  await open.setInputFiles({ name: 'as-yaml.studyflow.yaml', mimeType: 'text/yaml', buffer: Buffer.from(yamlText, 'utf8') });
  await expect(title).toHaveText('as-yaml');
  await expect(page.locator('[data-element-id="StartEvent_1"]')).toBeVisible();
  await open.setInputFiles({ name: 'as-png.studyflow.png', mimeType: 'image/png', buffer: pngBytes });
  await expect(title).toHaveText('as-png');
  await expect(page.locator('[data-element-id="StartEvent_1"]')).toBeVisible();
  await open.setInputFiles({ name: 'as-svg.studyflow.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svgText, 'utf8') });
  await expect(title).toHaveText('as-svg');
  await expect(page.locator('[data-element-id="StartEvent_1"]')).toBeVisible();
  await open.setInputFiles({ name: 'as-tif.studyflow.tif', mimeType: 'image/tiff', buffer: Buffer.from(tifBytes) });
  await expect(title).toHaveText('as-tif');
  await expect(page.locator('[data-element-id="StartEvent_1"]')).toBeVisible();
  // Saved again as a TIFF, it is offered the size it was opened at.
  await runPaletteCommand(page, /^Save As/);
  await page.getByTestId('export-format').selectOption('tif');
  await expect(page.getByTestId('export-print-width')).toHaveValue('50');
  await expect(page.getByTestId('export-print-dpi')).toHaveValue('100');
  await page.keyboard.press('Escape');

  // No schema declares `studyflow:retired`: the reader drops it, so the next save would too.
  await open.setInputFiles({
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
  await expect(page.getByTestId('notices')).toContainText(/retired\.bpmn/);
  await expect(page.getByTestId('notices')).toContainText(/<studyflow:retired>/);

  // Past the time a warning clears itself: this one names what the next save drops, so it waits to be dismissed.
  await page.clock.fastForward(10_000);
  await expect(page.getByTestId('notices')).toContainText(/retired\.bpmn/);
});
