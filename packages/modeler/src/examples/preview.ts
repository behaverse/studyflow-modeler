import { Canvas, Study, svgCreate } from '@canvas/index.ts';

/**
 * A YAML example's card picture as SVG: the main canvas only, without glyphs, which is what keeps
 * the gallery fast. Rewrites `definitions` into the form the canvas edits, so read them first.
 */
export function drawPreview(definitions: any): string {
  // A detached host, in the document the canvas draws into: the app's, or the one a spec installs.
  const host = svgCreate('svg').ownerDocument.createElement('div');
  const canvas = new Canvas(host, Study.fromDefinitions(definitions, { mainCanvasOnly: true }), { iconResolver: () => null });
  const svg = canvas.toSVG();
  canvas.destroy();
  return svg;
}
