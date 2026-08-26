/**
 * Ordered SVG layer stack (design §3 `view/layers.ts`). A fixed z-order of `<g>`
 * layers inside the canvas root: connections (bottom), shapes, overlays, selection
 * (top). The renderer draws edges into `connections` and nodes into `shapes`; later
 * phases use `overlays`/`selection`.
 *
 * All layers share the root's coordinate space (pan/zoom is applied to the root
 * `viewBox` by {@link Viewport}), so a layer is a plain untransformed group.
 */

import { append, create } from '@canvas/render/svg.ts';

/** The layers, bottom to top. */
export const LAYER_ORDER = ['connections', 'shapes', 'overlays', 'selection'] as const;

/** A layer name. */
export type LayerName = (typeof LAYER_ORDER)[number];

/** Owns the ordered `<g>` layer stack and the shared `<defs>`. */
export class Layers {
  readonly defs: SVGDefsElement;
  private readonly layers = new Map<LayerName, SVGGElement>();

  /** Build the layer groups (and `<defs>`) as children of `root`, in z-order. */
  constructor(root: SVGSVGElement) {
    this.defs = create('defs') as SVGDefsElement;
    append(root, this.defs);
    for (const name of LAYER_ORDER) {
      const g = create('g', { class: `sf-layer sf-layer-${name}`, 'data-layer': name }) as SVGGElement;
      append(root, g);
      this.layers.set(name, g);
    }
  }

  /** The `<g>` for a named layer. */
  getLayer(name: LayerName): SVGGElement {
    const layer = this.layers.get(name);
    if (!layer) throw new Error(`@behaverse/studyflow-canvas: unknown layer '${name}'`);
    return layer;
  }

  /** Remove every child from every layer (keeps `<defs>`). */
  clear(): void {
    for (const layer of this.layers.values()) {
      while (layer.firstChild) layer.removeChild(layer.firstChild);
    }
  }
}
