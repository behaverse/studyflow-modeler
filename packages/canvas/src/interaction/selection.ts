/**
 * Selection (design §3 `interaction/selection.ts`, §6 P2). Owns the current
 * selection set, draws a selection outline + resize-handle overlay for selected
 * nodes into the selection layer, and toggles marker CSS classes on element
 * graphics. Fires `selection.changed` on every change, matching the facade's
 * `EditorSelection` / `EditorEvents` contract (`packages/modeler/src/editor/port.ts`).
 *
 * Overlays are drawn in diagram coordinates directly into the (untransformed)
 * selection layer — pan/zoom lives in the root `viewBox`, so a diagram-space rect
 * renders correctly at any zoom. Handle glyphs are sized in screen pixels via the
 * injected `getScale`, so they stay roughly constant on screen.
 */

import type { EventBus } from '@canvas/events/bus.ts';
import type { Point, SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import { append, clear, create } from '@canvas/render/svg.ts';

/** The eight resize-handle anchors, in `data-handle` naming. */
export const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

/** A resize-handle anchor. */
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

/** Payload for the `selection.changed` event. */
export interface SelectionChangedEvent {
  newSelection: SceneElement[];
  oldSelection: SceneElement[];
}

/** Construction dependencies for {@link Selection}. */
export interface SelectionOptions {
  /** The SVG layer overlays are drawn into (typically the `selection` layer). */
  layer: SVGGElement;
  /** Resolves an element id to its rendered `<g>` (for marker toggling). */
  getGraphics: (id: string) => SVGGElement | undefined;
  /** Screen pixels per diagram unit, for constant-size handles. */
  getScale: () => number;
  /** Bus the `selection.changed` event is fired on. */
  bus: EventBus;
}

const OUTLINE_PADDING = 4;
const HANDLE_PX = 7;
/** Screen diameter of an edge waypoint handle. */
const WAYPOINT_HANDLE_PX = 8;

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

/** The selection set plus its on-canvas outline/handle overlay and marker toggling. */
export class Selection {
  private readonly layer: SVGGElement;
  private readonly getGraphics: (id: string) => SVGGElement | undefined;
  private readonly getScale: () => number;
  private readonly bus: EventBus;

  private selected: SceneElement[] = [];
  /** Applied markers per element id, so `removeMarker` can no-op cleanly. */
  private readonly markers = new Map<string, Set<string>>();

  constructor(options: SelectionOptions) {
    this.layer = options.layer;
    this.getGraphics = options.getGraphics;
    this.getScale = options.getScale;
    this.bus = options.bus;
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

  /** Redraw the overlay (e.g. after a zoom or a geometry edit). */
  refresh(): void {
    this.drawOverlay();
  }

  /** Add a marker CSS class to an element's graphics (idempotent). */
  addMarker(elementOrId: SceneElement | string, cssClass: string): void {
    const id = typeof elementOrId === 'string' ? elementOrId : elementOrId.id;
    const set = this.markers.get(id) ?? new Set<string>();
    set.add(cssClass);
    this.markers.set(id, set);
    this.getGraphics(id)?.classList.add(cssClass);
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
  }

  /** Whether an element's graphics currently carries `cssClass`. */
  hasMarker(elementOrId: SceneElement | string, cssClass: string): boolean {
    const id = typeof elementOrId === 'string' ? elementOrId : elementOrId.id;
    return this.markers.get(id)?.has(cssClass) ?? false;
  }

  /**
   * Re-apply the `selected` class and any markers to an element's graphics. The
   * renderer replaces the `<g>` wholesale when an element is redrawn (a live drag),
   * which would otherwise drop them.
   */
  restoreMarkers(elementOrId: SceneElement | string): void {
    const id = typeof elementOrId === 'string' ? elementOrId : elementOrId.id;
    const g = this.getGraphics(id);
    if (!g) return;
    for (const cssClass of this.markers.get(id) ?? []) g.classList.add(cssClass);
    if (this.isSelected(id)) g.classList.add('selected');
  }

  // --- overlay hit-testing (drives interaction/drag.ts) ----------------------

  /**
   * The resize handle of a selected node under a diagram-space `point`, or
   * `undefined`. Geometry-based (jsdom-safe) and screen-scaled, mirroring exactly
   * what {@link Selection.refresh} draws. Later-selected nodes win.
   */
  handleAt(point: Point): HandleHit | undefined {
    const scale = this.scale();
    const tolerance = HANDLE_PX / scale / 2;
    for (let i = this.selected.length - 1; i >= 0; i -= 1) {
      const node = this.selected[i];
      if (node.kind !== 'node') continue;
      const [x, y, w, h] = outlineRect(node);
      for (const anchor of RESIZE_HANDLES) {
        const [cx, cy] = handleCenter(anchor, x, y, w, h);
        if (Math.abs(point.x - cx) <= tolerance && Math.abs(point.y - cy) <= tolerance) {
          return { node, handle: anchor };
        }
      }
    }
    return undefined;
  }

  /**
   * The waypoint handle of a selected edge under a diagram-space `point`, or
   * `undefined`. Endpoints count as waypoints.
   */
  waypointAt(point: Point): WaypointHit | undefined {
    const tolerance = WAYPOINT_HANDLE_PX / this.scale() / 2;
    for (let i = this.selected.length - 1; i >= 0; i -= 1) {
      const edge = this.selected[i];
      if (edge.kind !== 'edge') continue;
      for (let index = 0; index < edge.waypoints.length; index += 1) {
        const p = edge.waypoints[index];
        if (Math.hypot(point.x - p.x, point.y - p.y) <= tolerance) return { edge, index };
      }
    }
    return undefined;
  }

  // --- internals ------------------------------------------------------------

  /** Screen pixels per diagram unit, guarded against a zero/absent layout. */
  private scale(): number {
    const scale = this.getScale();
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  private apply(next: SceneElement[], old: SceneElement[]): void {
    // Toggle the `selected` marker on graphics.
    for (const el of old) this.getGraphics(el.id)?.classList.remove('selected');
    for (const el of next) this.getGraphics(el.id)?.classList.add('selected');

    this.selected = next;
    this.drawOverlay();
    const event: SelectionChangedEvent = { newSelection: next.slice(), oldSelection: old.slice() };
    this.bus.fire('selection.changed', event);
  }

  /** Draw outlines + handles for the current selection into the selection layer. */
  private drawOverlay(): void {
    clear(this.layer);
    const scale = this.scale();
    for (const el of this.selected) {
      if (el.kind === 'node') this.drawNodeOverlay(el, scale);
      else this.drawEdgeOverlay(el, scale);
    }
  }

  private drawNodeOverlay(node: SceneNode, scale: number): void {
    const g = create('g', { class: 'sf-selection', 'data-element-id': node.id }) as SVGGElement;
    const [x, y, w, h] = outlineRect(node);
    const handle = HANDLE_PX / scale;
    append(g, create('rect', {
      class: 'sf-selection-outline',
      x, y, width: w, height: h,
      fill: 'none',
      stroke: '#1a73e8',
      'stroke-width': 1.5 / scale,
      'stroke-dasharray': `${4 / scale},${3 / scale}`,
    }));
    for (const anchor of RESIZE_HANDLES) {
      const [cx, cy] = handleCenter(anchor, x, y, w, h);
      append(g, create('rect', {
        class: 'sf-resize-handle',
        'data-handle': anchor,
        x: cx - handle / 2,
        y: cy - handle / 2,
        width: handle,
        height: handle,
        fill: '#ffffff',
        stroke: '#1a73e8',
        'stroke-width': 1 / scale,
      }));
    }
    append(this.layer, g);
  }

  private drawEdgeOverlay(edge: SceneEdge, scale: number): void {
    if (edge.waypoints.length < 2) return;
    const g = create('g', { class: 'sf-selection', 'data-element-id': edge.id }) as SVGGElement;
    const points = edge.waypoints.map((p) => `${p.x},${p.y}`).join(' ');
    append(g, create('polyline', {
      class: 'sf-selection-outline',
      points,
      fill: 'none',
      stroke: '#1a73e8',
      'stroke-width': 3 / scale,
      'stroke-opacity': 0.4,
    }));
    // Grab handles for `interaction/drag.ts`'s waypoint gesture.
    edge.waypoints.forEach((p, index) => {
      append(g, create('circle', {
        class: 'sf-waypoint-handle',
        'data-waypoint': index,
        cx: p.x,
        cy: p.y,
        r: WAYPOINT_HANDLE_PX / scale / 2,
        fill: '#ffffff',
        stroke: '#1a73e8',
        'stroke-width': 1 / scale,
      }));
    });
    append(this.layer, g);
  }
}

/** The padded outline rect drawn around a selected node, as `[x, y, w, h]`. */
function outlineRect(node: SceneNode): [number, number, number, number] {
  return [
    node.x - OUTLINE_PADDING,
    node.y - OUTLINE_PADDING,
    node.width + OUTLINE_PADDING * 2,
    node.height + OUTLINE_PADDING * 2,
  ];
}

/** Centre of a resize handle on the outline rect. */
function handleCenter(anchor: ResizeHandle, x: number, y: number, w: number, h: number): [number, number] {
  const midX = x + w / 2;
  const midY = y + h / 2;
  switch (anchor) {
    case 'nw': return [x, y];
    case 'n': return [midX, y];
    case 'ne': return [x + w, y];
    case 'e': return [x + w, midY];
    case 'se': return [x + w, y + h];
    case 's': return [midX, y + h];
    case 'sw': return [x, y + h];
    case 'w': return [x, midY];
  }
}
