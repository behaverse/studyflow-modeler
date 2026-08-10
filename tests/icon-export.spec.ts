import { expect, test } from '@playwright/test';

import { gotoModeler } from './utils';

/** Offline coverage for `embedIconsInSvg`, which normally resolves glyphs from the Iconify network API. */
test.describe('SVG export icon embedding (offline)', () => {
  test('embedIconsInSvg with nullIconSource does not throw and skips icons', async ({ page }) => {
    await gotoModeler(page);

    const result = await page.evaluate(async () => {
      // Compiler-visible test hook (src/modeler/testHooks.ts): renaming the export fails the build, not this test.
      const mod = window.__studyflowTest!;

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
        output = await mod.embedIconsInSvg(svg, { resolve: async () => null });
      } catch {
        threw = true;
      }
      return { threw, output };
    });

    expect(result.threw).toBe(false);
    expect(result.output).toContain('foreignObject');
    expect(result.output).toContain('i-ph--gear');
  });
});
