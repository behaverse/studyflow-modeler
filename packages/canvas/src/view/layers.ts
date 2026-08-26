/**
 * Ordered SVG layer stack (design §3 `view/layers.ts`). A fixed z-order of `<g>`
 * layers inside the canvas root: grid (bottom), connections, shapes, overlays,
 * selection (top). The renderer draws edges into `connections` and nodes into
 * `shapes`; later phases use `overlays`/`selection`.
 *
 * All layers share the root's coordinate space (pan/zoom is applied to the root
 * `viewBox` by {@link Viewport}), so a layer is a plain untransformed group.
 */

import { append, create, remove } from '@canvas/render/svg.ts';

/** The layers, bottom to top. */
export const LAYER_ORDER = ['grid', 'connections', 'shapes', 'overlays', 'selection'] as const;

/** A layer name. */
export type LayerName = (typeof LAYER_ORDER)[number];

/**
 * Grid geometry, verbatim from `diagram-js-grid` (P6b §3C): a dot every
 * `GRID_SPACING` diagram units, drawn as a 1px circle of `GRID_COLOR`, tiled over a
 * rect big enough that panning never runs off it. `patternUnits="userSpaceOnUse"`
 * anchors the tiling to the diagram origin, so the dots stay put under pan and zoom
 * (the canvas moves the root `viewBox`, never a layer transform).
 */
const GRID_SPACING = 10;
const GRID_COLOR = 'rgb(204, 204, 204)';
const GRID_EXTENT = 100000;

/** Unique per canvas instance: several canvases may share one document. */
let gridPatternSeq = 0;

/** Owns the ordered `<g>` layer stack and the shared `<defs>`. */
export class Layers {
  readonly defs: SVGDefsElement;
  private readonly layers = new Map<LayerName, SVGGElement>();
  /** The tiled rect, minted on the first {@link Layers.setGridVisible} call. */
  private gridRect: SVGRectElement | undefined;
  private gridVisible = false;

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

  /**
   * Remove every child from every layer (keeps `<defs>`).
   *
   * The grid is deliberately exempt: it is view chrome the host toggles from
   * settings, not document content, and an import must not silently turn it off.
   */
  clear(): void {
    for (const [name, layer] of this.layers) {
      if (name === 'grid') continue;
      while (layer.firstChild) layer.removeChild(layer.firstChild);
    }
  }

  /** Whether the background grid is currently painted. */
  isGridVisible(): boolean {
    return this.gridVisible;
  }

  /**
   * Show or hide the background dot grid. The `<pattern>` is minted into `<defs>`
   * on first use, so a canvas that never shows a grid serializes exactly as before
   * (the render goldens depend on that).
   */
  setGridVisible(visible: boolean): void {
    if (visible === this.gridVisible) return;
    this.gridVisible = visible;
    if (!visible) {
      remove(this.gridRect);
      return;
    }
    if (!this.gridRect) {
      gridPatternSeq += 1;
      const patternId = `sf-grid-pattern-${gridPatternSeq}`;
      const pattern = create('pattern', {
        id: patternId,
        // Marks the pattern as chrome so `Canvas.toSVG` can strip it from an export.
        'data-grid-pattern': '',
        width: GRID_SPACING,
        height: GRID_SPACING,
        patternUnits: 'userSpaceOnUse',
      });
      append(pattern, create('circle', { cx: 0.5, cy: 0.5, r: 0.5, fill: GRID_COLOR }));
      append(this.defs, pattern);
      this.gridRect = create('rect', {
        x: -GRID_EXTENT / 2,
        y: -GRID_EXTENT / 2,
        width: GRID_EXTENT,
        height: GRID_EXTENT,
        fill: `url(#${patternId})`,
      }) as SVGRectElement;
    }
    append(this.getLayer('grid'), this.gridRect);
  }
}
