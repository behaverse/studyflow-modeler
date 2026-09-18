import { expect, test } from '@playwright/test';

import { gotoModeler, readDownload, readDownloadText, runPaletteCommand } from './utils';

test('the Manuscript view writes the figure: an editable SVG draw.io reopens, and a plain PNG', async ({ page }) => {
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
  // A figure is a figure: no studyflow rides along, so nothing reopens it.
  expect(bytes.includes(Buffer.from('studyflow'))).toBe(false);
});
