import { Canvas } from '@canvas/index.ts';
import { fromWireDefinitions } from '@core/document';

/** One detached canvas draws every card; each import replaces the last scene. */
let canvas: Canvas | undefined;

/**
 * A YAML example's card picture as SVG: the main canvas only, without glyphs, which is what keeps
 * the gallery fast. Rewrites `definitions` into the form the canvas edits, so read them first.
 */
export function drawPreview(definitions: any): string {
  fromWireDefinitions(definitions);
  canvas ??= new Canvas({ iconResolver: () => null, mainCanvasOnly: true });
  canvas.importDefinitions(definitions);
  return canvas.toSVG();
}
