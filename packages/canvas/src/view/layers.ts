/**
 * Ordered SVG layer stack (design §3 `view/layers.ts`). A fixed z-order of `<g>`
 * layers inside the canvas root: grid (bottom), elements, overlays, selection (top).
 * The renderer draws every node AND every edge into the single `elements` layer;
 * later phases use `overlays`/`selection`.
 *
 * **Why one element layer.** The stack used to split `connections` (below) from
 * `shapes` (above), which made an expanded sub-process's opaque frame paint over the
 * very flows it contains: the interior shapes were spliced into the shapes layer
 * *after* their container and so stayed visible, while the interior edges sat in a
 * lower layer no depth splice could reach. Rendering and hit-testing then disagreed
 * — `interaction/hit.ts` happily returned an edge nobody could see. Merging the two
 * lets ONE composite order (`model/tree.ts depthOf`, then edges before nodes within
 * a depth) govern both: a container's frame still sits under the flows drawn at its
 * own level, so root arrowheads keep passing beneath their target shapes, while a
 * depth-1 interior flow now paints above the depth-0 frame that encloses it.
 *
 * All layers share the root's coordinate space (pan/zoom is applied to the root
 * `viewBox` by {@link Viewport}), so a layer is a plain untransformed group.
 */

import { append, create, remove } from '@canvas/render/svg.ts';

/** The layers, bottom to top. */
export const LAYER_ORDER = ['grid', 'elements', 'overlays', 'selection'] as const;

/** A layer name. */
export type LayerName = (typeof LAYER_ORDER)[number];

/**
 * The names the pre-merge stack used, kept resolving to the merged layer so a host
 * that still asks for `'shapes'` or `'connections'` gets a group rather than a throw.
 */
const LAYER_ALIASES: Readonly<Record<string, LayerName>> = {
  shapes: 'elements',
  connections: 'elements',
};

/** A layer name, or one of the two names the split stack answered to. */
export type LayerNameOrAlias = LayerName | 'shapes' | 'connections';

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

/**
 * Marks a HOST layer — one the app asked for by name through the port
 * ({@link Canvas.getHostLayer}), which lives above the built-in stack so its
 * chrome is not buried under the selection handles, and which an import drops the
 * way diagram-js drops its own overlays.
 */
export const CUSTOM_LAYER_ATTRIBUTE = 'data-layer-index';

/** Owns the ordered `<g>` layer stack and the shared `<defs>`. */
export class Layers {
  readonly defs: SVGDefsElement;
  private readonly root: SVGSVGElement;
  private readonly layers = new Map<LayerName, SVGGElement>();
  /** The tiled rect, minted on the first {@link Layers.setGridVisible} call. */
  private gridRect: SVGRectElement | undefined;
  private gridVisible = false;

  /** Build the layer groups (and `<defs>`) as children of `root`, in z-order. */
  constructor(root: SVGSVGElement) {
    this.root = root;
    this.defs = create('defs') as SVGDefsElement;
    append(root, this.defs);
    for (const name of LAYER_ORDER) {
      const g = create('g', { class: `sf-layer sf-layer-${name}`, 'data-layer': name }) as SVGGElement;
      append(root, g);
      this.layers.set(name, g);
    }
  }

  /** The `<g>` for a named layer (the two legacy names resolve to `elements`). */
  getLayer(name: LayerNameOrAlias): SVGGElement {
    const resolved = LAYER_ALIASES[name] ?? (name as LayerName);
    const layer = this.layers.get(resolved);
    if (!layer) throw new Error(`@behaverse/studyflow-canvas: unknown layer '${name}'`);
    return layer;
  }

  /**
   * Remove every child from every layer (keeps `<defs>`), and detach the host's own
   * layers wholesale — they belong to the document that was open, and the host
   * re-attaches on its next `getLayer` call.
   *
   * The grid is deliberately exempt: it is view chrome the host toggles from
   * settings, not document content, and an import must not silently turn it off.
   */
  clear(): void {
    for (const [name, layer] of this.layers) {
      if (name === 'grid') continue;
      while (layer.firstChild) layer.removeChild(layer.firstChild);
    }
    for (const custom of Array.from(this.root.querySelectorAll(`[${CUSTOM_LAYER_ATTRIBUTE}]`))) {
      remove(custom);
    }
  }

  /**
   * Insert a HOST layer above the built-in stack, ordered among its siblings by
   * `index` — so the app's own chrome (the drill-down badges, the simulation tokens)
   * sits over the selection handles rather than under them, which is where
   * diagram-js's HTML overlay container sits and the only place a badge anchored to a
   * shape's corner is actually clickable.
   */
  attachCustom(layer: SVGGElement, index: number): void {
    layer.setAttribute(CUSTOM_LAYER_ATTRIBUTE, String(index));
    const after = Array.from(this.root.children).find((sibling) => {
      const at = sibling.getAttribute(CUSTOM_LAYER_ATTRIBUTE);
      return at !== null && Number(at) > index;
    });
    if (after) this.root.insertBefore(layer, after);
    else append(this.root, layer);
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
