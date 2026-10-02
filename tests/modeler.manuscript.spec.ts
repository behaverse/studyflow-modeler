import { expect, test } from './e2e';

import { extractStudyflowFromPng } from '@core/document/png';

import { gotoModeler, readDownload, readDownloadText, runPaletteCommand } from './utils';

test('the Manuscript view writes the figure: an editable SVG draw.io reopens, and a PNG, each carrying the study', async ({ page }) => {
  await gotoModeler(page);
  await runPaletteCommand(page, /^View as Manuscript/);
  const dialog = page.getByTestId('manuscript-dialog');
  await expect(dialog).toBeVisible();
  // The figure is shown as it will be written, and the draw.io file is offered beside the two images.
  await expect(dialog.getByRole('img', { name: /figure/i })).toBeVisible();
  await expect(page.getByTestId('manuscript-drawio')).toBeVisible();

  const svgDownload = page.waitForEvent('download');
  await page.getByTestId('manuscript-editable-svg').click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toBe('diagram.svg');
  const svgText = await readDownloadText(svg);
  // Both payloads: the mxfile draw.io edits, and the BPMN that says what the picture is of.
  expect(svgText).toContain('content="&lt;mxfile');
  expect(svgText).toMatch(/<bpmn2?:definitions|<definitions/);

  const pngDownload = page.waitForEvent('download');
  await page.getByTestId('manuscript-figure-png').click();
  const png = await pngDownload;
  expect(png.suggestedFilename()).toBe('diagram.png');
  const bytes = await readDownload(png);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  // The study rides along, in the chunk a `.studyflow.png` keeps it in, so the figure reopens.
  expect(extractStudyflowFromPng(new Uint8Array(bytes))).toContain('definitions:');
});
