import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
  exportDiagram,
  gotoModeler,
  readDownload,
  readDownloadText,
  runPaletteCommand,
  stubIconify,
  uploadStudyflowDiagram,
} from './utils';

test.describe('Studyflow modeler file flows', () => {
  test('opens a local legacy (BPMN XML) studyflow file', async ({ page }) => {
    await gotoModeler(page);
    // 'Open File...' clicks a hidden <input type=file>; set files on it directly, no native chooser.
    await uploadStudyflowDiagram(page, 'sample.studyflow');

    await expect(page.getByTitle('Click to edit diagram name')).toHaveText('sample');
    await expect(page.getByTestId('modeler-canvas')).toBeVisible();
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
    await expect(page.locator('.djs-element[data-element-id="Enroll"]')).toBeVisible();
    await expect(page.locator('.djs-element[data-element-id="Eligibility_Gateway"]')).toBeVisible();
    await expect(page.locator('.djs-element[data-element-id="DidNotStart"]')).toBeVisible();
    await expect(page.locator('.djs-element[data-element-id="Done"]')).toBeVisible();
  });

  test('imports a jsPsych timeline JSON via the dedicated command', async ({ page }) => {
    await gotoModeler(page);

    // The jsPsych import has its own JSON-only <input>; plain 'Open File...' does not accept .json.
    await page.getByTestId('import-jspsych-input').setInputFiles({
      name: 'flanker.timeline.json',
      mimeType: 'application/json',
      buffer: readFileSync(path.join(process.cwd(), 'tests/fixtures/flanker.timeline.json')),
    });

    await expect(page.getByTitle('Click to edit diagram name')).toHaveText('flanker.timeline');
    await expect(page.locator('.djs-element[data-element-id="Start"]')).toBeVisible();
    await expect(page.locator('.djs-element[data-element-id="Flanker_test"]')).toBeVisible();
    await expect(page.locator('.djs-element[data-element-id="End"]')).toBeVisible();
    await expect(page.locator('.djs-element[data-element-id="Consent"]')).toHaveCount(0);
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
    expect(content).toContain('prov:Activity');
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
    await expect(page.locator('.djs-element[data-element-id^="StartEvent"]').first()).toBeVisible();
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
    await expect(page.locator('.djs-element[data-element-id^="StartEvent"]').first()).toBeVisible();
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

  test('the same exported PNG is also a draw.io diagram', async ({ page }) => {
    await gotoModeler(page);

    const filePath = await (await exportDiagram(page, 'png')).path();
    if (!filePath) throw new Error('Downloaded file path is unavailable.');
    const png = readFileSync(filePath);

    // draw.io reads the `mxfile` tEXt chunk and gives up at image data, so it must precede the first IDAT.
    const chunk = png.indexOf('mxfile', 0, 'ascii');
    expect(chunk).toBeGreaterThan(0);
    expect(chunk).toBeLessThan(png.indexOf('IDAT', 0, 'ascii'));

    const text = png.subarray(chunk + 'mxfile'.length + 1, png.indexOf('IDAT', 0, 'ascii') - 8);
    const diagram = decodeURIComponent(text.toString('latin1'));
    expect(diagram).toContain('<mxfile host="studyflow-modeler">');
    expect(diagram).toMatch(/<mxCell id="StartEvent[^"]*"[^>]*shape=mxgraph\.bpmn\.event/);
    expect(diagram).toContain('outline=standard;symbol=general;');
  });

  test('exports raw BPMN 2.0 XML', async ({ page }) => {
    await gotoModeler(page);

    const download = await exportDiagram(page, 'bpmn');

    await expect(download.suggestedFilename()).toBe('diagram.bpmn');
    const content = await readDownloadText(download);
    expect(content).toContain('<?xml');
    expect(content).toContain('bpmn');
  });

  test('exports a standalone draw.io file', async ({ page }) => {
    await gotoModeler(page);

    const download = await exportDiagram(page, 'drawio');

    expect(download.suggestedFilename()).toBe('diagram.drawio');
    const content = await readDownloadText(download);
    expect(content).toContain('<mxfile host="studyflow-modeler">');
    expect(content).toMatch(/<mxCell id="StartEvent[^"]*"[^>]*shape=mxgraph\.bpmn\.event/);
  });

  test('exported SVG carries the studyflow source and the draw.io diagram', async ({ page }) => {
    await gotoModeler(page);
    await stubIconify(page);

    const svgText = await readDownloadText(await exportDiagram(page, 'svg'));

    expect(svgText).toContain('<studyflow>');
    // draw.io's "editable SVG": the mxfile rides escaped in the root `content`.
    expect(svgText).toContain('content="&lt;mxfile');
  });

  test('the embed options decide what an exported image carries', async ({ page }) => {
    await gotoModeler(page);
    await stubIconify(page);

    const withBoth = await readDownload(await exportDiagram(page, 'png'));
    expect(withBoth.includes('iTXt')).toBe(true);
    expect(withBoth.includes('mxfile')).toBe(true);

    const plain = await readDownload(
      await exportDiagram(page, 'png', { studyflow: false, drawio: false }),
    );
    expect(plain.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(plain.includes('iTXt')).toBe(false);
    expect(plain.includes('mxfile')).toBe(false);
  });

  test('New starts from the gallery, whose blank entry replaces the diagram', async ({ page }) => {
    await gotoModeler(page);
    await uploadStudyflowDiagram(page, 'sample.studyflow');
    await expect(page.getByTitle('Click to edit diagram name')).toHaveText('sample');

    // 'New' opens the template gallery; the blank canvas is its first entry, not a separate command.
    await runPaletteCommand(page, 'New...');
    await page.getByTestId('new-diagram-blank').click();

    await expect(page.getByTitle('Click to edit diagram name')).not.toHaveText('sample');
    await expect(page.locator('.djs-element[data-element-id="StartEvent_1"]')).toBeVisible();
  });
});
