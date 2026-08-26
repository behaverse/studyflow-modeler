/**
 * Selection (design §3 `interaction/selection.ts`, §6 P2). Owns the current
 * selection set, paints the editor chrome that says what is selected, and toggles
 * marker CSS classes on element graphics. Fires `selection.changed` on every change,
 * matching the facade's `EditorSelection` / `EditorEvents` contract
 * (`packages/modeler/src/editor/port.ts`).
 *
 * The chrome is split the way bpmn-js splits it, because the two halves want
 * different coordinate frames:
 *
 * - **Outlines** live INSIDE the element's own `<g>` (`render/outline.ts`), in
 *   element-local coordinates, created lazily on first selection and then simply
 *   left there — the `selected` class decides whether they paint (`view/theme.ts`).
 *   Riding inside the element means an outline follows a move for free and can never
 *   drift from the shape it belongs to. A CONNECTION gets no outline at all: its
 *   selection is shown by its bendpoints appearing.
 * - **Handles** — resize chips and bendpoints — are drawn into the selection layer
 *   in diagram coordinates, so they can be cleared and re-laid-out in one pass and
 *   never end up under a neighbouring shape.
 *
 * Nothing here is screen-scaled. Pan/zoom lives in the root `viewBox`, so a
 * diagram-unit size is a CSS pixel at zoom 1 and scales with the diagram after that
 * — which is exactly what diagram-js does with the same numbers inside its viewport
 * transform, and what makes the 8x8 handle and the r=4 bendpoint of the parity spec
 * literal rather than approximate.
 */

import type { EventBus } from '@canvas/events/bus.ts';
import type { Point, SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import { ensureOutline } from '@canvas/render/outline.ts';
import { append, clear, create } from '@canvas/render/svg.ts';

/** The eight resize-handle anchors, in `data-handle` naming. */
export const RESIZE_HANDLES = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'] as const;

/** A resize-handle anchor. */
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

/** Payload for the `selection.changed` event. */
export interface SelectionChangedEvent {
  newSelection: SceneElement[];
  oldSelection: SceneElement[];
}

/** Construction dependencies for {@link Selection}. */
export interface SelectionOptions {
  /** The SVG layer handles are drawn into (typically the `selection` layer). */
  layer: SVGGElement;
  /** Resolves an element id to its rendered `<g>` (for outlines and markers). */
  getGraphics: (id: string) => SVGGElement | undefined;
  /** Bus the `selection.changed` event is fired on. */
  bus: EventBus;
  /**
   * The root `<svg>`, which carries the selection-wide state classes
   * (`sf-multi-select`) the style layer keys off — the same place diagram-js puts
   * `djs-multi-select`.
   */
  root?: Element;
  /**
   * Whether a node may be resized — `Rules.canResize` when the canvas wires it.
   * A node that answers `false` gets a selection outline but NO resize handles,
   * and {@link Selection.handleAt} reports no hit for it, so the overlay never
   * offers a gesture the rules would refuse (a start event and a gateway have a
   * fixed footprint in BPMN). Defaults to "everything resizes", which is what a
   * bare `Selection` outside a `Canvas` gets.
   */
  canResize?: (node: SceneNode) => boolean;
}

/** Edge of the square resize chip (diagram-js `HANDLE_SIZE`). */
const HANDLE_SIZE = 8;
/**
 * How far a chip is pushed OUT of the corner it marks (diagram-js `HANDLE_OFFSET`,
 * negated the same way): a corner chip spans ∓10…∓2 and an edge chip −4…+4 on its
 * free axis, which is the offset table of the parity spec.
 */
const HANDLE_OFFSET = 6;
/** Edge of the invisible square that actually takes the press. */
const HANDLE_HIT_SIZE = 20;

/** Radius of the visible bendpoint dot. */
const BENDPOINT_RADIUS = 4;
/** Radius of the invisible disc that takes a bendpoint press. */
const BENDPOINT_HIT_RADIUS = 10;

/** Marker set on the element being dragged; its handles and outline step aside. */
const DRAGGER_MARKER = 'sf-dragger';
/** Marker set on the shape being resized; same effect, different gesture. */
const RESIZING_MARKER = 'sf-resizing';
/**
 * Marker set on the element the inline label editor is open over. Its resize chips
 * step aside for as long as the editor stands there — the reference does exactly
 * that (parity spec §5 / `state-05-direct-editing.png`: the blue outline, no
 * handles), and eight chips around a box being typed into read as a resize
 * affordance the gesture is not offering.
 *
 * Unlike {@link RESIZING_MARKER} this does NOT hide the outline: `view/theme.ts`
 * deliberately has no rule for it, so the outline stays, which is the half of the
 * reference state the canvas already had right.
 */
export const EDITING_MARKER = 'sf-editing';
/** Class on the root while two or more elements are selected. */
const MULTI_SELECT_CLASS = 'sf-multi-select';

/** A resize handle grabbed from the selection overlay. */
export interface HandleHit {
  node: SceneNode;
  handle: ResizeHandle;
}

/** A waypoint handle grabbed from a selected edge's overlay. */
export interface WaypointHit {
  edge: SceneEdge;
  index: number;
}

/** The selection set plus its on-canvas chrome and marker toggling. */
export class Selection {
  private readonly layer: SVGGElement;
  private readonly getGraphics: (id: string) => SVGGElement | undefined;
  private readonly bus: EventBus;
  private readonly root?: Element;
  private readonly canResize: (node: SceneNode) => boolean;

  private selected: SceneElement[] = [];
  /** The connection the pointer is over, if any (bendpoints, and nothing else). */
  private hovered?: SceneEdge;
  /** Elements a live lasso has enclosed so far — marked, not yet selected. */
  private previewed: SceneElement[] = [];
  /** Applied markers per element id, so `removeMarker` can no-op cleanly. */
  private readonly markers = new Map<string, Set<string>>();

  constructor(options: SelectionOptions) {
    this.layer = options.layer;
    this.getGraphics = options.getGraphics;
    this.bus = options.bus;
    this.root = options.root;
    this.canResize = options.canResize ?? (() => true);
  }

  /** The current selection, in selection order (a copy). */
  get(): SceneElement[] {
    return this.selected.slice();
  }

  /** Whether `element` (or an id) is currently selected. */
  isSelected(element: SceneElement | string): boolean {
    const id = typeof element === 'string' ? element : element.id;
    return this.selected.some((e) => e.id === id);
  }

  /**
   * Replace the selection with `elements` (or, when `add` is true, union them in).
   * `null`/`[]` with `add` falsy clears. Mirrors `EditorSelection.select`.
   */
  select(elements: SceneElement | SceneElement[] | null, add = false): void {
    const list = elements == null ? [] : Array.isArray(elements) ? elements : [elements];
    const old = this.selected;
    let next: SceneElement[];
    if (add) {
      next = this.selected.slice();
      for (const el of list) if (!next.some((e) => e.id === el.id)) next.push(el);
    } else {
      // De-dupe while preserving order.
      next = [];
      for (const el of list) if (!next.some((e) => e.id === el.id)) next.push(el);
    }
    this.apply(next, old);
  }

  /** Add `element` to the selection (no-op if already selected). */
  add(element: SceneElement): void {
    if (this.isSelected(element)) return;
    this.apply([...this.selected, element], this.selected);
  }

  /** Remove `element` from the selection (no-op if not selected). */
  deselect(element: SceneElement): void {
    if (!this.isSelected(element)) return;
    this.apply(this.selected.filter((e) => e.id !== element.id), this.selected);
  }

  /** Toggle `element`'s membership (used by shift-click). */
  toggle(element: SceneElement): void {
    if (this.isSelected(element)) this.deselect(element);
    else this.add(element);
  }

  /** Clear the selection (fires `selection.changed` if it was non-empty). */
  clear(): void {
    if (this.selected.length === 0) return;
    this.apply([], this.selected);
  }

  /**
   * Mark `elements` as enclosed by a lasso that is still being dragged: they get the
   * `selected` class (and therefore an outline) without entering the selection set
   * and without firing `selection.changed`.
   *
   * This is how diagram-js does it too — `LassoTool` toggles the marker on
   * `lasso.move` and only calls `selection.select` on `lasso.end` — and it is what
   * makes the drag readable: the root carries `sf-dragging-active-lasso`, so every
   * marked outline paints in the *secondary* blue until the button comes up.
   */
  previewSelection(elements: readonly SceneElement[]): void {
    const next = new Map(elements.map((el) => [el.id, el] as const));
    for (const el of this.previewed) {
      if (next.has(el.id) || this.isSelected(el.id)) continue;
      this.getGraphics(el.id)?.classList.remove('selected');
    }
    for (const el of next.values()) {
      const g = this.getGraphics(el.id);
      if (!g) continue;
      g.classList.add('selected');
      this.applyOutline(el);
    }
    this.previewed = [...next.values()];
  }

  /** Drop the lasso marks; anything genuinely selected keeps its own. */
  clearPreview(): void {
    if (this.previewed.length > 0) this.previewSelection([]);
  }

  /** Redraw the chrome (e.g. after a geometry edit or a re-render). */
  refresh(): void {
    for (const el of this.selected) this.applyOutline(el);
    this.drawOverlay();
  }

  /**
   * Note which element the pointer is over. Hovering a SHAPE is deliberately inert
   * — bpmn-js changes nothing on screen for it, and the canvas matches that by
   * having nothing to change. Hovering a CONNECTION reveals its bendpoints, which is
   * the one hover that renders. Returns whether anything changed.
   */
  setHovered(element: SceneElement | undefined): boolean {
    const next = element && element.kind === 'edge' ? element : undefined;
    if (next === this.hovered) return false;
    this.hovered = next;
    this.drawOverlay();
    return true;
  }

  /** The connection currently hovered, if any. */
  getHovered(): SceneEdge | undefined {
    return this.hovered;
  }

  /** Add a marker CSS class to an element's graphics (idempotent). */
  addMarker(elementOrId: SceneElement | string, cssClass: string): void {
    const id = typeof elementOrId === 'string' ? elementOrId : elementOrId.id;
    const set = this.markers.get(id) ?? new Set<string>();
    set.add(cssClass);
    this.markers.set(id, set);
    this.getGraphics(id)?.classList.add(cssClass);
    // A gesture marker decides whether that element's handles are drawn at all —
    // and only a SELECTED element has any, so an unselected one costs no redraw.
    if (suppressesHandles(cssClass) && this.isSelected(id)) this.drawOverlay();
  }

  /** Remove a marker CSS class from an element's graphics (no-op if absent). */
  removeMarker(elementOrId: SceneElement | string, cssClass: string): void {
    const id = typeof elementOrId === 'string' ? elementOrId : elementOrId.id;
    const set = this.markers.get(id);
    if (set) {
      set.delete(cssClass);
      if (set.size === 0) this.markers.delete(id);
    }
    this.getGraphics(id)?.classList.remove(cssClass);
    if (suppressesHandles(cssClass) && this.isSelected(id)) this.drawOverlay();
  }

  /** Whether an element's graphics currently carries `cssClass`. */
  hasMarker(elementOrId: SceneElement | string, cssClass: string): boolean {
    const id = typeof elementOrId === 'string' ? elementOrId : elementOrId.id;
    return this.markers.get(id)?.has(cssClass) ?? false;
  }

  /**
   * Re-apply the `selected` class, any markers and the selection outline to an
   * element's graphics. The renderer replaces the `<g>` wholesale when an element is
   * redrawn (a live drag), which would otherwise drop all three.
   */
  restoreMarkers(elementOrId: SceneElement | string): void {
    const id = typeof elementOrId === 'string' ? elementOrId : elementOrId.id;
    const g = this.getGraphics(id);
    if (!g) return;
    for (const cssClass of this.markers.get(id) ?? []) g.classList.add(cssClass);
    if (!this.isSelected(id)) return;
    g.classList.add('selected');
    const element = this.selected.find((e) => e.id === id);
    if (element) this.applyOutline(element);
  }

  // --- overlay hit-testing (drives interaction/drag.ts) ----------------------

  /** Whether the overlay offers resize handles for `node` (see `SelectionOptions.canResize`). */
  isResizable(node: SceneNode): boolean {
    return this.canResize(node);
  }

  /**
   * The resize handle of a selected node under a diagram-space `point`, or
   * `undefined`. Geometry-based (jsdom-safe) and mirroring exactly what
   * {@link Selection.refresh} draws — the invisible 20x20 hit square of each chip,
   * corners before edges so an overlap on a small shape resolves the way the eye
   * expects. A non-resizable node has no handles drawn and reports no hit.
   * Later-selected nodes win.
   */
  handleAt(point: Point): HandleHit | undefined {
    for (let i = this.selected.length - 1; i >= 0; i -= 1) {
      const node = this.selected[i];
      if (node.kind !== 'node' || !this.canResize(node)) continue;
      if (this.handlesSuppressed(node.id)) continue;
      for (const anchor of RESIZE_HANDLES) {
        const [cx, cy] = handleAnchor(node, anchor);
        const [ox, oy] = handleOffset(anchor);
        const left = cx + ox - HANDLE_HIT_SIZE / 2;
        const top = cy + oy - HANDLE_HIT_SIZE / 2;
        if (
          point.x >= left && point.x <= left + HANDLE_HIT_SIZE
          && point.y >= top && point.y <= top + HANDLE_HIT_SIZE
        ) {
          return { node, handle: anchor };
        }
      }
    }
    return undefined;
  }

  /**
   * The bendpoint of a selected edge under a diagram-space `point`, or `undefined`.
   * Endpoints count as bendpoints. Matches the invisible r=10 disc that is drawn.
   */
  waypointAt(point: Point): WaypointHit | undefined {
    if (this.selected.length > 1) return undefined;
    for (let i = this.selected.length - 1; i >= 0; i -= 1) {
      const edge = this.selected[i];
      if (edge.kind !== 'edge') continue;
      for (let index = 0; index < edge.waypoints.length; index += 1) {
        const p = edge.waypoints[index];
        if (Math.hypot(point.x - p.x, point.y - p.y) <= BENDPOINT_HIT_RADIUS) return { edge, index };
      }
    }
    return undefined;
  }

  // --- internals ------------------------------------------------------------

  /**
   * Whether `id`'s resize chips are currently suppressed — it is the element a
   * move/resize gesture is driving, or the one the inline label editor is open over.
   * Suppression covers BOTH what {@link Selection.drawOverlay} draws and what
   * {@link Selection.handleAt} will report a hit for, so a chip that is not on
   * screen can never start a gesture.
   */
  private handlesSuppressed(id: string): boolean {
    return this.hasMarker(id, DRAGGER_MARKER)
      || this.hasMarker(id, RESIZING_MARKER)
      || this.hasMarker(id, EDITING_MARKER);
  }

  private apply(next: SceneElement[], old: SceneElement[]): void {
    // A lasso's marks are provisional: the real selection replaces them outright.
    this.clearPreview();
    // Toggle the `selected` marker on graphics.
    for (const el of old) this.getGraphics(el.id)?.classList.remove('selected');
    for (const el of next) this.getGraphics(el.id)?.classList.add('selected');

    this.selected = next;
    // Lazily: an outline is minted the first time its element is selected, and
    // survives deselection hidden — importing a large diagram creates none.
    for (const el of next) this.applyOutline(el);
    this.root?.classList.toggle(MULTI_SELECT_CLASS, next.length > 1);
    this.drawOverlay();
    const event: SelectionChangedEvent = { newSelection: next.slice(), oldSelection: old.slice() };
    this.bus.fire('selection.changed', event);
  }

  /** Mint/refresh the outline inside a selected element's `<g>`. */
  private applyOutline(element: SceneElement): void {
    // A connection has no outline in bpmn-js; drawing one and hiding it in CSS would
    // still put a stray node in every exported SVG.
    if (element.kind !== 'node') return;
    const g = this.getGraphics(element.id);
    if (g) ensureOutline(g, element);
  }

  /** Draw handles for the current selection (and the hovered connection). */
  private drawOverlay(): void {
    clear(this.layer);
    const multi = this.selected.length > 1;
    for (const el of this.selected) {
      if (el.kind === 'node') this.drawResizers(el);
      // Bendpoints are force-hidden under a multi-selection, as in diagram-js: the
      // gesture they offer only makes sense for one connection at a time.
      else if (!multi) this.drawBendpoints(el);
    }
    // Hovering a connection reveals the same bendpoints without selecting it.
    const hovered = this.hovered;
    if (hovered && !multi && !this.isSelected(hovered)) this.drawBendpoints(hovered);
  }

  /** The eight resize chips on a node's own bounds, if it may be resized. */
  private drawResizers(node: SceneNode): void {
    if (!this.canResize(node) || this.handlesSuppressed(node.id)) return;
    // `data-overlay-for`, NOT `data-element-id`: this group decorates the node, it is
    // not the node. bpmn-js keeps `.djs-resizer` inside the element's own `<g>`, so
    // `[data-element-id="x"]` matches exactly one node there — host code and e2e
    // selectors rely on that, and a second match in the selection layer breaks them.
    const g = create('g', { class: 'sf-resizers', 'data-overlay-for': node.id }) as SVGGElement;
    for (const anchor of RESIZE_HANDLES) {
      const [cx, cy] = handleAnchor(node, anchor);
      const [ox, oy] = handleOffset(anchor);
      const handle = create('g', {
        class: `sf-resizer sf-resizer-${anchor}`,
        'data-handle': anchor,
        transform: `translate(${cx}, ${cy})`,
      }) as SVGGElement;
      append(handle, create('rect', {
        class: 'sf-resizer-visual',
        x: ox - HANDLE_SIZE / 2,
        y: oy - HANDLE_SIZE / 2,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
      }));
      append(handle, create('rect', {
        class: 'sf-resizer-hit',
        x: ox - HANDLE_HIT_SIZE / 2,
        y: oy - HANDLE_HIT_SIZE / 2,
        width: HANDLE_HIT_SIZE,
        height: HANDLE_HIT_SIZE,
      }));
      append(g, handle);
    }
    append(this.layer, g);
  }

  /** One dot per waypoint of a connection — its entire selection affordance. */
  private drawBendpoints(edge: SceneEdge): void {
    if (edge.waypoints.length < 2) return;
    // Decoration, not the edge — see `drawResizers` on `data-overlay-for`.
    const g = create('g', { class: 'sf-bendpoints', 'data-overlay-for': edge.id }) as SVGGElement;
    edge.waypoints.forEach((p, index) => {
      const point = create('g', {
        class: 'sf-bendpoint',
        'data-waypoint': index,
        transform: `translate(${p.x}, ${p.y})`,
      }) as SVGGElement;
      append(point, create('circle', { class: 'sf-bendpoint-visual', cx: 0, cy: 0, r: BENDPOINT_RADIUS }));
      append(point, create('circle', { class: 'sf-bendpoint-hit', cx: 0, cy: 0, r: BENDPOINT_HIT_RADIUS }));
      append(g, point);
    });
    append(this.layer, g);
  }
}

/** Whether a marker class changes which handles the overlay is allowed to draw. */
function suppressesHandles(cssClass: string): boolean {
  return cssClass === DRAGGER_MARKER
    || cssClass === RESIZING_MARKER
    || cssClass === EDITING_MARKER;
}

/**
 * The point on a node's BOUNDS a handle marks — a corner or an edge midpoint
 * (diagram-js `getReferencePoint`). Note it is the bounds, not the outline: the chip
 * straddles the shape's own edge.
 */
function handleAnchor(node: SceneNode, anchor: ResizeHandle): [number, number] {
  const x = anchor.includes('w')
    ? node.x
    : anchor.includes('e') ? node.x + node.width : node.x + node.width / 2;
  const y = anchor.includes('n')
    ? node.y
    : anchor.includes('s') ? node.y + node.height : node.y + node.height / 2;
  return [x, y];
}

/** How far a chip is pushed off its anchor, outward along each constrained axis. */
function handleOffset(anchor: ResizeHandle): [number, number] {
  const x = anchor.includes('e') ? HANDLE_OFFSET : anchor.includes('w') ? -HANDLE_OFFSET : 0;
  const y = anchor.includes('s') ? HANDLE_OFFSET : anchor.includes('n') ? -HANDLE_OFFSET : 0;
  return [x, y];
}

/** The chip geometry for one handle, as `[x, y, size]` in diagram coordinates. */
export function resizeHandleRect(node: SceneNode, anchor: ResizeHandle): [number, number, number] {
  const [cx, cy] = handleAnchor(node, anchor);
  const [ox, oy] = handleOffset(anchor);
  return [cx + ox - HANDLE_SIZE / 2, cy + oy - HANDLE_SIZE / 2, HANDLE_SIZE];
}
