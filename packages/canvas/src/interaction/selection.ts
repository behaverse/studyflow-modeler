/**
 * Selection (design §3 `interaction/selection.ts`, §6 P2). Owns the current
 * selection set, paints the editor chrome that says what is selected, and toggles
 * marker CSS classes on element graphics. Fires `selection.changed` on every change.
 *
 * This IS `Editor.selection`: the facade publishes this object rather than a
 * projection of it (`../editor.ts`), which is why {@link Selection.select} is
 * lenient about what a caller names an element by.
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
import { isLabelElement } from '@canvas/model/externalLabel.ts';
import type { Bounds, Point, SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import { ensureOutline, OUTLINE_OFFSET } from '@canvas/render/outline.ts';
import { boxContains, centerOf } from '@canvas/routing/crop.ts';
import { append, clear, create } from '@canvas/render/svg.ts';
import {
  insideGrip,
  isGrippable,
  segmentAt as segmentOfPath,
  segmentsOf,
  SEGMENT_GRIP_LENGTH,
  SEGMENT_GRIP_WIDTH,
  type SegmentAxis,
} from '@canvas/interaction/segments.ts';

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
  /**
   * Turns whatever a caller names an element by — an id, a detached shape, a plane
   * projection — into the scene element it stands for ({@link Canvas.resolveElement}).
   *
   * It exists so `Editor.selection` can BE this object: app chrome selects by
   * whatever it happens to be holding, and an unresolvable reference must drop out of
   * the set rather than enter it. Defaults to "take it as given", which is what a
   * bare `Selection` outside a `Canvas` gets.
   */
  resolve?: (value: unknown) => SceneElement | undefined;
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
  /**
   * Whether `index` names a joint that does not exist YET: a press on a connection's
   * body inserts one there and drags it (diagram-js's floating bendpoint). The
   * insertion happens when the gesture actually starts moving, so a plain click on a
   * flow still just selects it.
   */
  insert?: boolean;
}

/** A straight run of a connection grabbed by its move grip (or by its body). */
export interface SegmentHit {
  edge: SceneEdge;
  /** Index of the run's FIRST waypoint (`interaction/segments.ts`). */
  index: number;
  /** `true` for the grip (slide the run), `false` for its body (insert a joint). */
  grip: boolean;
}

/**
 * The segment grip's glyph, re-measured off `edge-videos/v2/frame_10` pixel by
 * pixel (the frame is a 2x capture; the grip beside the vertical run under
 * "Announce readiness" draws each triangle ~16px wide and ~14px tall with an ~8px
 * channel between them, i.e. 8 x 7 units with a 4-unit gap).
 *
 * The gap is the load-bearing number. An earlier revision used reach 5 / gap 1,
 * which leaves only two units of white between the two bases: at 100% zoom that
 * channel closes and the pair reads as one solid diamond, which says "drag me
 * anywhere" rather than "this run slides across". `REACH` is how far a tip sits
 * from the run, `GAP` where its base starts, so a triangle is `REACH - GAP` long
 * and `2 * BASE` across its base.
 */
const GRIP_TRIANGLE_REACH = 8;
const GRIP_TRIANGLE_BASE = 3.5;
/** Gap between the run and the base of each triangle — half the channel between them. */
const GRIP_TRIANGLE_GAP = 3;

/**
 * Edge of the blue chip drawn at each corner and side midpoint of a SELECTED
 * label's outline (`edge-videos/labels/frame_08`). The same 8 units as a resize
 * chip — it is visibly the same widget — but these are INERT: a label is not
 * resizable (there is no label-resize mutation to write back), so they carry no
 * `data-handle` and {@link Selection.handleAt} can never report one.
 */
const LABEL_CHIP_SIZE = 8;

/** The selection set plus its on-canvas chrome and marker toggling. */
export class Selection {
  private readonly layer: SVGGElement;
  private readonly getGraphics: (id: string) => SVGGElement | undefined;
  private readonly bus: EventBus;
  private readonly root?: Element;
  private readonly canResize: (node: SceneNode) => boolean;
  private readonly resolve: (value: unknown) => SceneElement | undefined;

  private selected: SceneElement[] = [];
  /** The connection the pointer is over, if any (bendpoints, and nothing else). */
  private hovered?: SceneEdge;
  /** The one segment grip on offer: the run under the pointer, and where its glyph sits. */
  private hoveredGrip?: { edge: SceneEdge; index: number; axis: SegmentAxis; at: Point };
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
    this.resolve = options.resolve ?? ((value) => value as SceneElement | undefined);
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
   * `null`/`undefined`/`[]` with `add` falsy clears.
   *
   * Lenient about what an element IS ({@link SelectionOptions.resolve}): host chrome
   * hands over ids and detached shapes as readily as scene elements, and anything
   * that resolves to nothing is simply not selected.
   */
  select(
    elements: SceneElement | string | readonly (SceneElement | string)[] | null | undefined,
    add = false,
  ): void {
    const named = elements == null ? [] : Array.isArray(elements) ? elements : [elements];
    const list: SceneElement[] = [];
    for (const value of named as readonly unknown[]) {
      const element = this.resolve(value);
      if (element) list.push(element);
    }
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
   * Note which element the pointer is over — and, with `point`, WHERE it is.
   * Hovering a SHAPE is deliberately inert — bpmn-js changes nothing on screen for
   * it, and the canvas matches that by having nothing to change. Hovering a
   * CONNECTION reveals its bendpoints, and hovering one of its straight RUNS puts
   * the segment-move grip under the pointer ({@link Selection.drawSegmentGrips}) —
   * the two hovers that render. Returns whether anything changed.
   */
  setHovered(element: SceneElement | undefined, point?: Point): boolean {
    const next = element && element.kind === 'edge' ? element : undefined;
    const edgeChanged = next !== this.hovered;
    this.hovered = next;
    const grip = this.gripUnder(point);
    const gripChanged = !sameGrip(grip, this.hoveredGrip);
    this.hoveredGrip = grip;
    if (!edgeChanged && !gripChanged) return false;
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
   * Drop every marker remembered for `elementOrId` — the element is gone.
   *
   * The map is keyed by ID, and IDs are minted PER DOCUMENT (`model/ids.ts`), so a
   * surviving entry is not merely stale: delete `Activity_1`, draw a new one, and it
   * would come back wearing the dead one's markers. `Canvas.deleteElements` calls
   * this for everything it removes; pass no argument on import, which replaces the
   * whole id space at once.
   */
  forget(elementOrId?: SceneElement | string): void {
    if (elementOrId === undefined) {
      this.markers.clear();
      return;
    }
    this.markers.delete(typeof elementOrId === 'string' ? elementOrId : elementOrId.id);
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

  /**
   * The straight RUN of a connection under a diagram-space `point`, or `undefined`
   * — the segment-move gesture of parity spec §2/§3. Offered for the same
   * connections the bendpoints are (a single selected one, or the hovered one) and
   * mirroring exactly what {@link Selection.drawOverlay} draws: the grip box first,
   * then the run's own body, whose press ADDS a joint rather than sliding the run
   * (`grip: false` — see {@link SegmentHit}).
   *
   * Bendpoints win over runs — {@link Canvas} asks {@link Selection.waypointAt}
   * first — so a grab near a joint moves the joint, never the line through it.
   *
   * `gripsOnly` narrows the query to the drawn grip boxes, dropping the run's body.
   * A press that landed on a SHAPE passes it: chrome the user can see wins over the
   * shape under it, but a connection merely crossing a pool must not quietly steal
   * every press that lands within five units of it.
   */
  segmentAt(point: Point, options: { gripsOnly?: boolean } = {}): SegmentHit | undefined {
    for (const edge of this.edgesWithChrome()) {
      const segment = segmentOfPath(edge.waypoints, point, options);
      if (segment) return { edge, index: segment.index, grip: segment.grip };
    }
    return undefined;
  }

  // --- internals ------------------------------------------------------------

  /**
   * The connections currently wearing edge chrome (bendpoints and segment grips):
   * a lone selected one, plus the hovered one. A multi-selection has none, as in
   * diagram-js — the gestures they offer only make sense one connection at a time.
   */
  private edgesWithChrome(): SceneEdge[] {
    if (this.selected.length > 1) return [];
    const out: SceneEdge[] = [];
    for (const el of this.selected) if (el.kind === 'edge') out.push(el);
    const hovered = this.hovered;
    if (hovered && !this.isSelected(hovered)) out.push(hovered);
    return out;
  }

  /**
   * The grip a pointer at `point` earns: the first grippable run of a connection
   * wearing edge chrome whose grip box the point is inside. The glyph sits at the
   * run's MIDDLE, where diagram-js parks its segment dragger — the rest of the run
   * belongs to the joint-inserting drag ({@link Selection.segmentAt}).
   */
  private gripUnder(
    point: Point | undefined,
  ): { edge: SceneEdge; index: number; axis: SegmentAxis; at: Point } | undefined {
    if (!point) return undefined;
    for (const edge of this.edgesWithChrome()) {
      const segment = segmentsOf(edge.waypoints).find((s) => isGrippable(s) && insideGrip(s, point));
      if (segment) return { edge, index: segment.index, axis: segment.axis, at: segment.mid };
    }
    return undefined;
  }

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
      // A caption is its own element, and its chrome is its own too: inert chips
      // plus the dashed leader that says which element it names (addendum 3 §3).
      if (isLabelElement(el)) this.drawLabelChrome(el as SceneNode);
      else if (el.kind === 'node') this.drawResizers(el);
      // Bendpoints are force-hidden under a multi-selection, as in diagram-js: the
      // gesture they offer only makes sense for one connection at a time.
      else if (!multi) this.drawEdgeChrome(el);
    }
    // Hovering a connection reveals the same chrome without selecting it.
    const hovered = this.hovered;
    if (hovered && !multi && !this.isSelected(hovered)) this.drawEdgeChrome(hovered);
  }

  /**
   * A selected caption's whole overlay (parity spec addendum 3 §3,
   * `edge-videos/labels/frame_08`): a dashed blue LEADER back to the element it
   * names, and eight blue chips around its outline.
   *
   * The leader is what the user's callout was about — a label dragged clear of its
   * flow otherwise reads as a free-floating annotation. It is drawn even while the
   * caption is being dragged (that is when the association is hardest to see);
   * the chips step aside for the gesture like every other handle.
   */
  private drawLabelChrome(label: SceneNode): void {
    this.drawLabelLeader(label);
    if (this.handlesSuppressed(label.id)) return;
    this.drawLabelChips(label);
  }

  /** The dashed line from a caption's nearest side to the element it names. */
  private drawLabelLeader(label: SceneNode): void {
    const owner = label.labelTarget;
    if (!owner) return;
    const box = labelOutlineBox(label);
    const target = closestPointOn(owner, centerOf(box));
    if (!target || boxContains(box, target)) return;
    const from = nearestSideMidpoint(box, target);
    const g = create('g', { class: 'sf-label-leaders', 'data-overlay-for': label.id }) as SVGGElement;
    append(g, create('line', {
      class: 'sf-label-leader',
      'data-label-owner': owner.id,
      x1: from.x,
      y1: from.y,
      x2: target.x,
      y2: target.y,
    }));
    append(this.layer, g);
  }

  /**
   * The eight chips of `edge-videos/labels/frame_08`. Decoration ONLY — see
   * {@link LABEL_CHIP_SIZE}: no `data-handle`, so no gesture can start on them.
   */
  private drawLabelChips(label: SceneNode): void {
    const box = labelOutlineBox(label);
    const g = create('g', { class: 'sf-label-chips', 'data-overlay-for': label.id }) as SVGGElement;
    for (const anchor of RESIZE_HANDLES) {
      const x = anchor.includes('w')
        ? box.x
        : anchor.includes('e') ? box.x + box.width : box.x + box.width / 2;
      const y = anchor.includes('n')
        ? box.y
        : anchor.includes('s') ? box.y + box.height : box.y + box.height / 2;
      append(g, create('rect', {
        class: `sf-label-chip sf-label-chip-${anchor}`,
        x: x - LABEL_CHIP_SIZE / 2,
        y: y - LABEL_CHIP_SIZE / 2,
        width: LABEL_CHIP_SIZE,
        height: LABEL_CHIP_SIZE,
      }));
    }
    append(this.layer, g);
  }

  /** A connection's whole overlay: a dot per waypoint, a grip per straight run. */
  private drawEdgeChrome(edge: SceneEdge): void {
    this.drawBendpoints(edge);
    this.drawSegmentGrips(edge);
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

  /**
   * The move grip of the ONE run the pointer is over — the affordance parity spec
   * §2 calls "the big missing piece". A horizontal run carries the `ns` grip (it
   * travels up/down), a vertical one the `ew` grip, which is the pairing
   * `edge-videos/v2/frame_10` shows: `◄ ►` sitting on the vertical segment below
   * the source task.
   *
   * As in diagram-js, the grip is parked at the run's midpoint and appears while the
   * pointer is inside its box ({@link Selection.gripUnder}) — the rest of the
   * connection shows only its bendpoints, and a drag there inserts one.
   *
   * The glyph is a pair of solid DARK triangles pointing apart — the one piece of
   * edge chrome that is not diagram-js blue — over an invisible 20x18 hit box.
   */
  private drawSegmentGrips(edge: SceneEdge): void {
    const hovered = this.hoveredGrip;
    if (!hovered || hovered.edge.id !== edge.id) return;
    const direction = hovered.axis === 'h' ? 'ns' : 'ew';
    // Decoration, not the edge — see `drawResizers` on `data-overlay-for`.
    const g = create('g', { class: 'sf-segment-grips', 'data-overlay-for': edge.id }) as SVGGElement;
    const grip = create('g', {
      class: `sf-segment-grip sf-segment-grip-${direction}`,
      'data-segment': hovered.index,
      transform: `translate(${hovered.at.x}, ${hovered.at.y})`,
    }) as SVGGElement;
    append(grip, create('path', {
      class: 'sf-segment-grip-visual',
      d: gripGlyph(direction),
    }));
    append(grip, create('rect', {
      class: 'sf-segment-grip-hit',
      x: -(hovered.axis === 'h' ? SEGMENT_GRIP_LENGTH : SEGMENT_GRIP_WIDTH) / 2,
      y: -(hovered.axis === 'h' ? SEGMENT_GRIP_WIDTH : SEGMENT_GRIP_LENGTH) / 2,
      width: hovered.axis === 'h' ? SEGMENT_GRIP_LENGTH : SEGMENT_GRIP_WIDTH,
      height: hovered.axis === 'h' ? SEGMENT_GRIP_WIDTH : SEGMENT_GRIP_LENGTH,
    }));
    append(g, grip);
    append(this.layer, g);
  }
}

/** Whether two grip offers are the same run at the same spot. */
function sameGrip(
  a: { edge: SceneEdge; index: number; at: Point } | undefined,
  b: { edge: SceneEdge; index: number; at: Point } | undefined,
): boolean {
  if (!a || !b) return a === b;
  return a.edge === b.edge && a.index === b.index && a.at.x === b.at.x && a.at.y === b.at.y;
}

/**
 * The double-triangle glyph of a segment grip, in the grip's own frame: `▲▼` for a
 * run that may travel up and down, `◄►` for one that may travel left and right.
 */
function gripGlyph(direction: 'ns' | 'ew'): string {
  const reach = GRIP_TRIANGLE_REACH;
  const base = GRIP_TRIANGLE_BASE;
  const gap = GRIP_TRIANGLE_GAP;
  if (direction === 'ns') {
    return `M 0 ${-reach} L ${-base} ${-gap} L ${base} ${-gap} Z`
      + ` M 0 ${reach} L ${-base} ${gap} L ${base} ${gap} Z`;
  }
  return `M ${-reach} 0 L ${-gap} ${-base} L ${-gap} ${base} Z`
    + ` M ${reach} 0 L ${gap} ${-base} L ${gap} ${base} Z`;
}

// --- label chrome geometry (pure; asserted directly by the unit tests) -------

/**
 * The box a caption's chrome hangs off: its text box grown by the same
 * {@link OUTLINE_OFFSET} its selection outline uses, so the chips sit ON the outline
 * and the leader starts where the user sees the box end, not where the glyphs do.
 */
export function labelOutlineBox(label: SceneNode): Bounds {
  return {
    x: label.x - OUTLINE_OFFSET,
    y: label.y - OUTLINE_OFFSET,
    width: label.width + OUTLINE_OFFSET * 2,
    height: label.height + OUTLINE_OFFSET * 2,
  };
}

/**
 * The point of `owner` nearest `from` — a point on the polyline for a connection,
 * a point on the bounds rectangle for a shape. This is where a caption's leader
 * lands: on the line it names, at its closest approach.
 */
export function closestPointOn(owner: SceneElement, from: Point): Point | undefined {
  if (owner.kind === 'edge') {
    const points = owner.waypoints;
    if (points.length === 0) return undefined;
    let best = points[0];
    let bestDistance = Infinity;
    for (let i = 0; i + 1 < points.length; i += 1) {
      const candidate = closestPointOnSegment(points[i], points[i + 1], from);
      const distance = Math.hypot(candidate.x - from.x, candidate.y - from.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return { x: best.x, y: best.y };
  }
  if (owner.kind !== 'node') return undefined;
  return {
    x: Math.min(Math.max(from.x, owner.x), owner.x + owner.width),
    y: Math.min(Math.max(from.y, owner.y), owner.y + owner.height),
  };
}

/** The point of segment `a`→`b` nearest `p` (clamped to the segment). */
function closestPointOnSegment(a: Point, b: Point, p: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { x: a.x, y: a.y };
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * The midpoint of whichever side of `box` faces `target` — the leader leaves the
 * caption from its bottom edge when the flow runs below it (`labels/frame_08`),
 * from its left edge when the flow is off to the left, and so on.
 */
export function nearestSideMidpoint(box: Bounds, target: Point): Point {
  const sides: Point[] = [
    { x: box.x + box.width / 2, y: box.y },
    { x: box.x + box.width / 2, y: box.y + box.height },
    { x: box.x, y: box.y + box.height / 2 },
    { x: box.x + box.width, y: box.y + box.height / 2 },
  ];
  let best = sides[0];
  let bestDistance = Infinity;
  for (const side of sides) {
    const distance = Math.hypot(side.x - target.x, side.y - target.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = side;
    }
  }
  return best;
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
