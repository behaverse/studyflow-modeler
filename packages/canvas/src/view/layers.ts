/** The `<g>` layer stack inside the root: elements, overlays, selection, then host layers on top. */

import { append, create, remove } from '@canvas/render/svg.ts';

export const LAYER_ORDER = ['elements', 'overlays', 'selection'] as const;
export type LayerName = (typeof LAYER_ORDER)[number];

/** Marks a host layer, which an import drops and the host re-attaches on its next request. */
export const CUSTOM_LAYER_ATTRIBUTE = 'data-layer-index';

export class Layers {
  readonly defs: SVGDefsElement;
  private readonly root: SVGSVGElement;
  private readonly layers = new Map<LayerName, SVGGElement>();

  constructor(root: SVGSVGElement) {
    this.root = root;
    this.defs = append(root, create('defs')) as SVGDefsElement;
    for (const name of LAYER_ORDER) {
      const g = append(root, create('g', { class: `sf-layer sf-layer-${name}`, 'data-layer': name })) as SVGGElement;
      this.layers.set(name, g);
    }
  }

  getLayer(name: LayerName): SVGGElement {
    const layer = this.layers.get(name);
    if (!layer) throw new Error(`@behaverse/studyflow-canvas: unknown layer '${name}'`);
    return layer;
  }

  /** Empty every layer (keeps `<defs>`) and detach the host layers. */
  clear(): void {
    for (const layer of this.layers.values()) while (layer.firstChild) layer.removeChild(layer.firstChild);
    for (const custom of Array.from(this.root.querySelectorAll(`[${CUSTOM_LAYER_ATTRIBUTE}]`))) remove(custom);
  }

  /** Insert a host layer above the built-in stack, ordered by `index`. */
  attachCustom(layer: SVGGElement, index: number): void {
    layer.setAttribute(CUSTOM_LAYER_ATTRIBUTE, String(index));
    const after = Array.from(this.root.children).find((sibling) => {
      const at = sibling.getAttribute(CUSTOM_LAYER_ATTRIBUTE);
      return at !== null && Number(at) > index;
    });
    if (after) this.root.insertBefore(layer, after);
    else append(this.root, layer);
  }
}
