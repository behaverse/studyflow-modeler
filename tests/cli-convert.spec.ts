import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './e2e';

import { extractStudyflowFromPng, extractStudyflowFromSvg, extractStudyflowFromTiff, pngSize, tiffResolution, tiffSize } from '@core/document';
import { pixelsAcross, widthOnPaper } from '@modeler/export/printSize';
import { examplePath } from '@tests/utils';

/** `studyflow convert --modeler` draws a new picture by driving the modeler, in any image format. */

test('convert --modeler draws a .studyflow.png, .studyflow.svg or .studyflow.tif that carries its study', async ({ baseURL }, testInfo) => {
  test.setTimeout(180_000);
  // The CLI reads its schemas through Vite (`import.meta.glob`), so it is built here, inside the
  // repo, where it finds @playwright/test to drive the modeler with.
  const bin = testInfo.outputPath('bin');
  execFileSync(process.execPath, [path.join(process.cwd(), 'node_modules/vite/bin/vite.js'), 'build', 'packages/cli', '--outDir', bin, '--logLevel', 'error'], { stdio: 'pipe' });

  for (const format of ['png', 'svg', 'tif']) {
    const output = testInfo.outputPath(`drawn_loop.studyflow.${format}`);
    const run = spawnSync(process.execPath, [
      path.join(bin, 'studyflow.mjs'), 'convert', examplePath('drawn_loop'), output, '--modeler', '--origin', baseURL!, ...(format === 'tif' ? ['--dpi', '150'] : []),
    ], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    const study = format === 'png'
      ? extractStudyflowFromPng(readFileSync(output))
      : format === 'svg' ? extractStudyflowFromSvg(readFileSync(output, 'utf8')) : extractStudyflowFromTiff(readFileSync(output));
    expect(study, format).toContain('drawn_loop');
  }
  // The SVG is the modeler's own drawing, not an empty frame around the embedded study.
  expect(readFileSync(testInfo.outputPath('drawn_loop.studyflow.svg'), 'utf8')).toContain('class="sf-shape"');
  // The TIFF prints the PNG's width, a pixel a unit, at 0.2 mm a unit and the dpi asked for.
  const tif = readFileSync(testInfo.outputPath('drawn_loop.studyflow.tif'));
  expect(tiffResolution(tif)).toEqual({ x: 150, y: 150 });
  expect(tiffSize(tif).width).toBe(pixelsAcross(widthOnPaper(pngSize(readFileSync(testInfo.outputPath('drawn_loop.studyflow.png'))).width), 150));
});
