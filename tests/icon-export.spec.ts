import { expect, test, type Page } from '@playwright/test';

import { exampleFile, exportDiagram, gotoModeler, readDownload, readDownloadText } from './utils';

/**
 * Native SVG icons, end to end (parity addendum 6 §1–§2).
 *
 * Icons used to be mounted as `<foreignObject><div class="i-…">` and substituted for
 * real glyphs at EXPORT time, then fetched from the Iconify API at startup. Now the
 * canvas reads each class's glyph out of the app's own stylesheet (the Tailwind
 * iconify plugin compiles every icon into a `--svg` data URI) and draws real `<path>`
 * geometry — so the export is a plain serialization, offline, with no icon pass.
 */

/** An icon-rich example: typed service tasks (type glyph) and data operations (marker glyph). */
async function openExample(page: Page, filename: string, title: string): Promise<void> {
  await page.getByTestId('open-file-input').setInputFiles({
    name: filename,
    mimeType: 'image/png',
    buffer: exampleFile(filename),
  });
  await expect(page.getByTitle('Click to edit diagram name')).toContainText(title);
}

test.describe('native SVG icons', () => {
  test('glyphs are drawn as real <svg> paths from the stylesheet, never a foreignObject', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => { if (request.url().includes('iconify')) requests.push(request.url()); });
    await gotoModeler(page);
    await openExample(page, 'sklearn_pipeline.studyflow.png', 'sklearn_pipeline');

    const canvas = page.getByTestId('modeler-canvas');
    await expect(canvas.locator('svg.sf-icon path').first()).toBeAttached();
    await expect(canvas.locator('foreignObject.icon-container')).toHaveCount(0);
    expect(requests).toEqual([]);
  });

  test('the exported SVG and PNG carry the glyph paths and need no icon toolchain', async ({ page }) => {
    await gotoModeler(page);
    await openExample(page, 'sklearn_pipeline.studyflow.png', 'sklearn_pipeline');
    await expect(page.getByTestId('modeler-canvas').locator('svg.sf-icon path').first()).toBeAttached();

    const svg = await readDownloadText(await exportDiagram(page, 'svg'));
    expect(svg).toMatch(/<svg[^>]*class="sf-icon"[^>]*>\s*<path/);
    // The whole point: the exported document needs no stylesheet to paint, and
    // `currentColor` is already resolved to the element's own stroke colour.
    expect(svg).not.toContain('foreignObject');
    expect(svg).not.toContain('data-icon-class');
    expect(svg).not.toContain('currentColor');

    const png = await readDownload(await exportDiagram(page, 'png'));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  test('a container activity exports no placeholder box where BPMN draws no icon', async ({ page }) => {
    // `bpmn:SubProcess`, `bpmn:CallActivity`, `bpmn:Transaction` and `bpmn:AdHocSubProcess`
    // have no top-left type glyph in BPMN at all — their marker and their border say what
    // they are — so the app answers "no glyph" for them rather than "not yet".
    await gotoModeler(page);
    await openExample(page, 'kitchensink.studyflow.png', 'kitchen sink');

    const canvas = page.getByTestId('modeler-canvas');
    await expect(canvas.locator('svg.sf-icon path').first()).toBeAttached();
    await expect(canvas.locator('g.sf-icon-placeholder')).toHaveCount(0);

    const svg = await readDownloadText(await exportDiagram(page, 'svg'));
    expect(svg).not.toContain('sf-icon-placeholder');
  });
});
