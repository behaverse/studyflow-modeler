import { expect, test } from '@playwright/test';

import { gotoModeler } from './utils';

/**
 * Offline coverage for the icon-embedding step of the SVG/PNG export path.
 *
 * `embedIconsInSvg` normally resolves icon glyphs from the Iconify network API
 * (`remoteIconSource`). That makes export untestable offline. The injectable
 * `IconSource` injection point lets us pass `bundledIconSource`, which resolves nothing,
 * so the transform runs fully offline: icon foreignObjects are left untouched
 * and the call must not throw.
 *
 * The transform relies on browser `DOMParser`/`XMLSerializer`, which Node lacks,
 * so we run it inside the already-loaded app page via a Vite dynamic import.
 */
test.describe('SVG export icon embedding (offline)', () => {
  test('embedIconsInSvg with bundledIconSource does not throw and skips icons', async ({ page }) => {
    await gotoModeler(page);

    const result = await page.evaluate(async () => {
      // Vite dev-server root is `./src`, so modules are served without the `src/` prefix.
      // Paths are held in variables so tsc treats these as runtime dynamic imports.
      const modPath = '/modeler/models/exporters/svgEmbedding.ts';
      const iconPath = '/modeler/infra/iconSource.ts';
      const mod = await import(modPath);
      const icons = await import(iconPath);

      const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
        '  <foreignObject class="icon-container" x="10" y="10" width="24" height="24">',
        '    <div data-icon-class="i-ph--gear" data-icon-color="#333"></div>',
        '  </foreignObject>',
        '</svg>',
      ].join('\n');

      let threw = false;
      let output = '';
      try {
        output = await mod.embedIconsInSvg(svg, icons.bundledIconSource);
      } catch {
        threw = true;
      }
      return { threw, output };
    });

    expect(result.threw).toBe(false);
    // bundledIconSource resolves nothing, so the icon foreignObject is left in place.
    expect(result.output).toContain('foreignObject');
    expect(result.output).toContain('i-ph--gear');
  });
});
