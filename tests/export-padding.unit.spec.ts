import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';

import { padSvg } from '@modeler/export/svgEmbedding';

/** A tight bounding box clips stroke halves, arrowheads and overhanging labels, so an exported figure is padded. */

test('an exported figure is padded: its box moves out by the margin and grows by twice it', () => {
  // `padSvg` parses with the browser's DOMParser and XMLSerializer; jsdom's stand in for them here.
  const { window } = new JSDOM('');
  Object.assign(globalThis, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer });
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="412 240 36 36">'
      + '<rect x="412" y="240" width="36" height="36" fill="black"/></svg>';
    const root = padSvg(svg).match(/<svg[^>]*>/)?.[0];

    // The drawing keeps its scale and gains a border.
    expect(root).toContain('viewBox="404 232 52 52"');
    expect(root).toContain('width="52"');
    expect(root).toContain('height="52"');
  } finally {
    delete (globalThis as any).DOMParser;
    delete (globalThis as any).XMLSerializer;
  }
});
