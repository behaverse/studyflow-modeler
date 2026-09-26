import { Study, renderSvg } from '@canvas/index.ts';

/**
 * A YAML example's card picture as SVG: what the diagram shows, without glyphs, which is what keeps
 * the gallery fast. Rewrites `definitions` into the form the canvas edits, so read them first.
 */
export function drawPreview(definitions: any): string {
  return renderSvg(Study.fromDefinitions(definitions), { iconResolver: () => null });
}
