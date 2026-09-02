/**
 * The selection set and its chrome: an outline inside each selected element's
 * `<g>`, corner handles and bendpoints in the selection layer, marker classes.
 */

import type { EventBus } from '@core/events/bus.ts';
import type { Point, SceneEdge, SceneElement, SceneLabel, SceneNode } from '@canvas/model/scene.ts';
import { append, clear, create } from '@canvas/render/svg.ts';

export const RESIZE_HANDLES = ['nw', 'ne', 'se', 'sw'] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];
export type Resizable = SceneNode | SceneLabel;

export interface SelectionChangedEvent {
  newSelection: SceneElement[];
  oldSelection: SceneElement[];
}

export interface SelectionOptions {
  layer: SVGGElement;
  getGraphics: (id: string) => SVGGElement | undefined;
  bus: EventBus;
  root?: Element;
  canResize?: (target: Resizable) => boolean;
  /** Turns whatever a caller names an element by (an id, a stale copy) into the scene element. */
  resolve?: (value: unknown) => SceneElement | undefined;
}

const HANDLE_SIZE = 7;
const HANDLE_HIT_SIZE = 16;
const BENDPOINT_RADIUS = 3.5;
const BENDPOINT_HIT_RADIUS = 9;
export const OUTLINE_OFFSET = 4;
export const OUTLINE_CLASS = 'sf-outline';
export const RESIZING_MARKER = 'sf-resizing';
export const EDITING_MARKER = 'sf-editing';
const MULTI_SELECT_CLASS = 'sf-multi-select';

export interface HandleHit {
  target: Resizable;
  handle: ResizeHandle;
}

export interface WaypointHit {
  edge: SceneEdge;
  index: number;
  /** A press on the line: a joint is inserted there once the gesture moves. */
  insert?: boolean;
}

export class Selection {
  private readonly layer: SVGGElement;
  private readonly getGraphics: (id: string) => SVGGElement | undefined;
  private readonly bus: EventBus;
  private readonly root?: Element;
  private readonly canResize: (target: Resizable) => boolean;
  private readonly resolve: (value: unknown) => SceneElement | undefined;
  private selected: SceneElement[] = [];
  private hovered?: SceneEdge;
  private previewed: SceneElement[] = [];
  private readonly markers = new Map<string, Set<string>>();

  constructor(options: SelectionOptions) {
    this.layer = options.layer;
    this.getGraphics = options.getGraphics;
    this.bus = options.bus;
    this.root = options.root;
    this.canResize = options.canResize ?? (() => true);
    this.resolve = options.resolve ?? ((value) => value as SceneElement | undefined);
  }

  get(): SceneElement[] {
    return this.selected.slice();
  }

  isSelected(element: SceneElement | string): boolean {
    const id = typeof element === 'string' ? element : element.id;
    return this.selected.some((e) => e.id === id);
  }

  /** Replace the selection (or union it in with `add`); unresolvable names are dropped. */
  select(elements: unknown, add = false): void {
    const named = elements == null ? [] : Array.isArray(elements) ? elements : [elements];
    const next: SceneElement[] = add ? this.selected.slice() : [];
    for (const value of named as readonly unknown[]) {
      const element = this.resolve(value);
      if (element && !next.some((e) => e.id === element.id)) next.push(element);
    }
    this.apply(next, this.selected);
  }

  add(element: SceneElement): void {
    if (!this.isSelected(element)) this.apply([...this.selected, element], this.selected);
  }

  deselect(element: SceneElement): void {
    if (this.isSelected(element)) this.apply(this.selected.filter((e) => e.id !== element.id), this.selected);
  }

  toggle(element: SceneElement): void {
    if (this.isSelected(element)) this.deselect(element);
    else this.add(element);
  }

  clear(): void {
    if (this.selected.length > 0) this.apply([], this.selected);
  }

  /** Outline what a live marquee encloses without selecting it yet. */
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

  clearPreview(): void {
    if (this.previewed.length > 0) this.previewSelection([]);
  }

  refresh(): void {
    for (const el of this.selected) this.applyOutline(el);
    this.drawOverlay();
  }

  /** Hovering a connection reveals its bendpoints. */
  setHovered(element: SceneElement | undefined): boolean {
    const next = element && element.kind === 'edge' ? element : undefined;
    if (next === this.hovered) return false;
    this.hovered = next;
    this.drawOverlay();
    return true;
  }

  getHovered(): SceneEdge | undefined {
    return this.hovered;
  }

  addMarker(elementOrId: SceneElement | string, cssClass: string): void {
    const id = typeof elementOrId === 'string' ? elementOrId : elementOrId.id;
    const set = this.markers.get(id) ?? new Set<string>();
    set.add(cssClass);
    this.markers.set(id, set);
    this.getGraphics(id)?.classList.add(cssClass);
    if (suppressesHandles(cssClass) && this.isSelected(id)) this.drawOverlay();
  }

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

  hasMarker(elementOrId: SceneElement | string, cssClass: string): boolean {
    const id = typeof elementOrId === 'string' ? elementOrId : elementOrId.id;
    return this.markers.get(id)?.has(cssClass) ?? false;
  }

  /** Forget markers for a deleted element (or all of them, on import). */
  forget(elementOrId?: SceneElement | string): void {
    if (elementOrId === undefined) this.markers.clear();
    else this.markers.delete(typeof elementOrId === 'string' ? elementOrId : elementOrId.id);
  }

  /** Re-apply `selected`, markers and the outline after an element's `<g>` was replaced. */
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

  handleAt(point: Point): HandleHit | undefined {
    for (let i = this.selected.length - 1; i >= 0; i -= 1) {
      const target = this.selected[i];
      if (target.kind === 'edge' || !this.canResize(target) || this.handlesSuppressed(target.id)) continue;
      for (const handle of RESIZE_HANDLES) {
        const [cx, cy] = handleAnchor(target, handle);
        if (Math.abs(point.x - cx) <= HANDLE_HIT_SIZE / 2 && Math.abs(point.y - cy) <= HANDLE_HIT_SIZE / 2) {
          return { target, handle };
        }
      }
    }
    return undefined;
  }

  waypointAt(point: Point): WaypointHit | undefined {
    for (const edge of this.edgesWithChrome()) {
      for (let index = 0; index < edge.waypoints.length; index += 1) {
        const p = edge.waypoints[index];
        if (Math.hypot(point.x - p.x, point.y - p.y) <= BENDPOINT_HIT_RADIUS) return { edge, index };
      }
    }
    return undefined;
  }

  /** A lone selected connection, plus the hovered one. */
  private edgesWithChrome(): SceneEdge[] {
    if (this.selected.length > 1) return this.hovered ? [this.hovered] : [];
    const out: SceneEdge[] = [];
    for (const el of this.selected) if (el.kind === 'edge') out.push(el);
    if (this.hovered && !this.isSelected(this.hovered)) out.push(this.hovered);
    return out;
  }

  private handlesSuppressed(id: string): boolean {
    return this.hasMarker(id, RESIZING_MARKER) || this.hasMarker(id, EDITING_MARKER);
  }

  private apply(next: SceneElement[], old: SceneElement[]): void {
    this.clearPreview();
    for (const el of old) this.getGraphics(el.id)?.classList.remove('selected');
    for (const el of next) this.getGraphics(el.id)?.classList.add('selected');
    this.selected = next;
    for (const el of next) this.applyOutline(el);
    this.root?.classList.toggle(MULTI_SELECT_CLASS, next.length > 1);
    this.drawOverlay();
    const event: SelectionChangedEvent = { newSelection: next.slice(), oldSelection: old.slice() };
    this.bus.fire('SelectionChanged', event);
  }

  /** A rounded rect just outside the element, drawn once and toggled by class. */
  private applyOutline(element: SceneElement): void {
    if (element.kind === 'edge') return;
    const g = this.getGraphics(element.id);
    if (!g) return;
    const attrs = {
      x: -OUTLINE_OFFSET,
      y: -OUTLINE_OFFSET,
      width: element.width + OUTLINE_OFFSET * 2,
      height: element.height + OUTLINE_OFFSET * 2,
      rx: 8,
    };
    const existing = g.querySelector(`:scope > .${OUTLINE_CLASS}`);
    if (existing) {
      for (const [name, value] of Object.entries(attrs)) existing.setAttribute(name, String(value));
      return;
    }
    const outline = create('rect', { class: OUTLINE_CLASS, ...attrs });
    if (g.firstChild) g.insertBefore(outline, g.firstChild);
    else append(g, outline);
  }

  private drawOverlay(): void {
    clear(this.layer);
    for (const el of this.selected) {
      if (el.kind !== 'edge') this.drawHandles(el);
    }
    for (const edge of this.edgesWithChrome()) this.drawBendpoints(edge);
  }

  private drawHandles(target: Resizable): void {
    if (!this.canResize(target) || this.handlesSuppressed(target.id)) return;
    const g = create('g', { class: 'sf-handles', 'data-overlay-for': target.id }) as SVGGElement;
    for (const handle of RESIZE_HANDLES) {
      const [cx, cy] = handleAnchor(target, handle);
      const h = create('g', { class: `sf-handle sf-handle-${handle}`, 'data-handle': handle, transform: `translate(${cx}, ${cy})` });
      append(h, create('rect', { class: 'sf-handle-visual', x: -HANDLE_SIZE / 2, y: -HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE, rx: 1.5 }));
      append(h, create('rect', { class: 'sf-handle-hit', x: -HANDLE_HIT_SIZE / 2, y: -HANDLE_HIT_SIZE / 2, width: HANDLE_HIT_SIZE, height: HANDLE_HIT_SIZE }));
      append(g, h);
    }
    append(this.layer, g);
  }

  private drawBendpoints(edge: SceneEdge): void {
    if (edge.waypoints.length < 2) return;
    const g = create('g', { class: 'sf-bendpoints', 'data-overlay-for': edge.id }) as SVGGElement;
    edge.waypoints.forEach((p, index) => {
      const point = create('g', { class: 'sf-bendpoint', 'data-waypoint': index, transform: `translate(${p.x}, ${p.y})` });
      append(point, create('circle', { class: 'sf-bendpoint-visual', r: BENDPOINT_RADIUS }));
      append(point, create('circle', { class: 'sf-bendpoint-hit', r: BENDPOINT_HIT_RADIUS }));
      append(g, point);
    });
    append(this.layer, g);
  }
}

function suppressesHandles(cssClass: string): boolean {
  return cssClass === RESIZING_MARKER || cssClass === EDITING_MARKER;
}

/** The corner a handle sits on, just outside the outline. */
function handleAnchor(target: Resizable, handle: ResizeHandle): [number, number] {
  const x = handle.includes('w') ? target.x - OUTLINE_OFFSET : target.x + target.width + OUTLINE_OFFSET;
  const y = handle.includes('n') ? target.y - OUTLINE_OFFSET : target.y + target.height + OUTLINE_OFFSET;
  return [x, y];
}
