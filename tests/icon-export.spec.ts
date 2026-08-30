import { expect, test, type Page } from '@playwright/test';

import { exampleFile, exportDiagram, gotoModeler, readDownloadText } from './utils';

/**
 * Native SVG icons, end to end (parity addendum 6 §1–§2).
 *
 * Icons used to be mounted as `<foreignObject><div class="i-…">` and substituted for
 * real glyphs at EXPORT time (`export/svgEmbedding.embedIconsInSvg`, deleted). Now
 * `draw/iconCache.ts` pre-resolves the catalog's classes through the same Iconify
 * source, hands the bodies to the canvas renderer, and the scene itself carries real
 * `<path>` geometry — so the export is a plain serialization with no icon pass.
 *
 * Every request to the Iconify API is intercepted here, so the suite stays offline
 * and deterministic: the served glyph is a square, and finding that square drawn in
 * the diagram (and in the exported file) is the proof the pipeline is connected.
 */

const GLYPH_PATH = 'M4 4h16v16H4z';

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
  + `<path d="${GLYPH_PATH}" fill="currentColor"/></svg>`;

/** Serve every icon as {@link GLYPH_PATH}; `available: false` fails the lookup instead. */
async function routeIconify(page: Page, available = true): Promise<void> {
  await page.route('https://api.iconify.design/**', (route) => (available
    ? route.fulfill({ status: 200, contentType: 'image/svg+xml', body: ICON_SVG })
    : route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' })));
}

/** An icon-rich example: typed service tasks (type glyph) and data operations (marker glyph). */
async function openIconRichExample(page: Page): Promise<void> {
  const filename = 'sklearn_pipeline.studyflow.png';
  await page.getByTestId('open-file-input').setInputFiles({
    name: filename,
    mimeType: 'image/png',
    buffer: exampleFile(filename),
  });
  await expect(page.getByTitle('Click to edit diagram name')).toHaveText('sklearn_pipeline');
}

test.describe('native SVG icons', () => {
  test('resolved glyphs are drawn as real <svg> paths, not foreignObject icons', async ({ page }) => {
    // Routed before the app boots: the icon cache primes the catalog on mount.
    await routeIconify(page);
    await gotoModeler(page);
    await openIconRichExample(page);

    const canvas = page.getByTestId('modeler-canvas');
    // The glyph bodies arrive asynchronously and re-draw the elements that wanted them.
    await expect(canvas.locator(`svg.sf-icon path[d="${GLYPH_PATH}"]`).first()).toBeAttached();
    await expect(canvas.locator('foreignObject.icon-container')).toHaveCount(0);
  });

  test('the exported SVG carries the glyph paths and no foreignObject at all', async ({ page }) => {
    await routeIconify(page);
    await gotoModeler(page);
    await openIconRichExample(page);

    const canvas = page.getByTestId('modeler-canvas');
    await expect(canvas.locator(`svg.sf-icon path[d="${GLYPH_PATH}"]`).first()).toBeAttached();

    const svg = await readDownloadText(await exportDiagram(page, 'svg'));

    expect(svg).toContain(GLYPH_PATH);
    // The whole point: the exported document needs no icon toolchain to paint, and
    // `currentColor` is already resolved to the element's own stroke colour.
    expect(svg).not.toContain('foreignObject');
    expect(svg).not.toContain('data-icon-class');
    expect(svg).not.toContain('currentColor');
  });

  test('a container activity exports no placeholder box where BPMN draws no icon', async ({ page }) => {
    // Addendum 6 §5 asks the exported SVG to hold real icon paths. It held 33 of them
    // and five faint boxes with a letter inside: `bpmn:SubProcess`,
    // `bpmn:CallActivity`, `bpmn:Transaction` and `bpmn:AdHocSubProcess` have no
    // top-left type glyph in BPMN at all — their marker and their border say what
    // they are — so the app now answers "no glyph" for them rather than "not yet".
    await routeIconify(page);
    await gotoModeler(page);
    const filename = 'kitchensink.studyflow.png';
    await page.getByTestId('open-file-input').setInputFiles({
      name: filename,
      mimeType: 'image/png',
      buffer: exampleFile(filename),
    });
    await expect(page.getByTitle('Click to edit diagram name')).toContainText('kitchen sink');

    const canvas = page.getByTestId('modeler-canvas');
    await expect(canvas.locator(`svg.sf-icon path[d="${GLYPH_PATH}"]`).first()).toBeAttached();
    await expect(canvas.locator('g.sf-icon-placeholder')).toHaveCount(0);

    const svg = await readDownloadText(await exportDiagram(page, 'svg'));
    expect(svg).toContain(GLYPH_PATH);
    expect(svg).not.toContain('sf-icon-placeholder');
  });

  test('an icon that cannot be fetched leaves the CSS placeholder, and nothing throws', async ({ page }) => {
    await routeIconify(page, false);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    await gotoModeler(page);
    await openIconRichExample(page);

    const canvas = page.getByTestId('modeler-canvas');
    // Unresolved is a drawing state, not a failure: the class-carrying placeholder
    // stays put (and is what a later arrival would replace).
    await expect(canvas.locator('foreignObject.icon-container').first()).toBeAttached();
    await expect(canvas.locator(`svg.sf-icon path[d="${GLYPH_PATH}"]`)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
