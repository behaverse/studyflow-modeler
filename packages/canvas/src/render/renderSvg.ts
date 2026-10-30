/**
 * `renderSvg`: a study as a standalone SVG picture, drawn afresh without a canvas and without its
 * chrome (no selection, no gestures, no host layers). A gallery card, an export, a picture made in
 * Node, which hands it a `document` to mint the picture in (jsdom's, say).
 */

import { isPastedImage } from '@core/model/pastedImages.ts';

import { ensureArrowMarkers, Renderer, type RendererOptions } from '@canvas/render/renderer.ts';
import { append, attr, create, ownerDocument, withDocument } from '@canvas/render/svg.ts';
import type { SceneElement, SceneNode } from '@canvas/study/scene.ts';
import { studyInternals, type Study } from '@canvas/study/Study.ts';
import { boundsOf, isHidden } from '@canvas/study/tree.ts';

export interface RenderSvgOptions extends RendererOptions {
  /** Draw what a view drilled into the container of this id shows; without one, the whole diagram. */
  scope?: string;
  /** Where to mint the picture: the page's document when not given. */
  document?: Document;
  /** Draw the images pasted on the study, as a `.studyflow.png` does; without this they, and what links to them, are left out. */
  pastedImages?: boolean;
}

/** Room round the drawing, so a stroke on its edge is not cut. */
const MARGIN = 4;

/** What a view of `study` shows, as SVG text framed on it: nothing inside a collapsed container, nothing outside `scope`. */
export function renderSvg(study: Study, { scope, document, pastedImages = false, ...options }: RenderSvgOptions = {}): string {
  const container = scope === undefined ? undefined : studyInternals(study).scene.elementsById.get(scope);
  const draw = (): string => picture(study, container?.kind === 'node' ? container : undefined, pastedImages, options);
  return document ? withDocument(document, draw) : draw();
}

/** Whether `element` is a pasted image, or a link to one. */
function ofPastedImage(element: SceneElement): boolean {
  if (element.kind === 'edge') return isPastedImage(element.source?.element) || isPastedImage(element.target?.element);
  return element.kind === 'node' && isPastedImage(element.element);
}

function picture(study: Study, scope: SceneNode | undefined, pastedImages: boolean, options: RendererOptions): string {
  const { scene } = studyInternals(study);
  const shows = (element: SceneElement): boolean => !isHidden(element, scope) && (pastedImages || !ofPastedImage(element));
  const svg = create('svg', { xmlns: 'http://www.w3.org/2000/svg', class: 'sf-canvas' });
  ensureArrowMarkers(append(svg, create('defs')));
  const renderer = new Renderer(options);
  renderer.scope = scope;
  renderer.renderScene(scene, append(svg, create('g', { 'data-layer': 'elements' })), shows);
  const box = boundsOf([...scene.elementsById.values()].filter(shows));
  if (box) {
    const width = box.width + MARGIN * 2;
    const height = box.height + MARGIN * 2;
    attr(svg, { viewBox: `${box.x - MARGIN} ${box.y - MARGIN} ${width} ${height}`, width, height });
  }
  const view = ownerDocument().defaultView;
  return view ? new view.XMLSerializer().serializeToString(svg) : svg.outerHTML;
}
