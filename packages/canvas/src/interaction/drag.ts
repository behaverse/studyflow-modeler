/**
 * Direct manipulation — move, resize, and waypoint drags (design §3
 * `interaction/drag.ts`, §6 P3).
 *
 * A gesture runs in three beats: {@link Drag.startMove}/{@link Drag.startResize}/
 * {@link Drag.startWaypoint} snapshot the original geometry, {@link Drag.update}
 * re-derives the whole gesture from the *original* snapshot plus the total pointer
 * delta (never an accumulated per-move delta, so snapping and clamping stay exact),
 * and {@link Drag.end} commits through {@link Writeback} — which is the moment the
 * backing DI moddle objects (`dc:Bounds`, `di:waypoint`) are written, the scene
 * revision bumps, and `element.changed` fires. {@link Drag.cancel} restores the
 * snapshot without ever touching the DI.
 *
 * While a gesture is live only the SCENE is mutated (and the affected graphics
 * redrawn through the injected `redraw`), so an abandoned drag leaves the document
 * model untouched.
 *
 * Connected edges follow their node minimally, as P3 allows (full orthogonal
 * re-routing is P4, design §6):
 *
 * - **move** — an edge translates its docking waypoint by the same delta; an edge
 *   whose *both* endpoints move translates every waypoint, so its shape is kept.
 * - **resize** — the docking waypoint is re-docked to the new outline via
 *   {@link dockingPoint} (the segment from the node centre toward the neighbouring
 *   waypoint, clipped to the bounds).
 *
 * An explicitly positioned external label (`bpmndi:BPMNLabel` with a `dc:Bounds`)
 * rides along with its shape — translated by the move delta, re-anchored to the shape
 * centre on resize — and is written back with it (`model/writeback.ts`).
 */

import type {
  Bounds,
  Point,
  SceneEdge,
  SceneElement,
  SceneNode,
} from '@canvas/model/scene.ts';
import type { Writeback } from '@canvas/model/writeback.ts';
import type { ResizeHandle } from '@canvas/interaction/selection.ts';

/** Grid step used when snapping is enabled. */
export const DEFAULT_GRID_SIZE = 10;

/** Smallest width/height a resize gesture may produce (diagram units). */
export const DEFAULT_MIN_SIZE = 20;

/** Which gesture is in flight. */
export type DragKind = 'move' | 'resize' | 'waypoint';

/** Construction dependencies for {@link Drag}. */
export interface DragOptions {
  /** Applies the committed scene geometry to the DI moddle objects. */
  writeback: Writeback;
  /** Redraw these elements' graphics (live feedback during the gesture). */
  redraw: (elements: SceneElement[]) => void;
  /** Snap edited coordinates to {@link DragOptions.gridSize}. Default `false`. */
  snapToGrid?: boolean;
  /** Grid step for snapping. Default {@link DEFAULT_GRID_SIZE}. */
  gridSize?: number;
  /** Minimum node width/height on resize. Default {@link DEFAULT_MIN_SIZE}. */
  minSize?: number;
}

/** How a followed edge reacts to its node moving. */
type EdgeFollow = 'all' | 'first' | 'last';

interface MoveState {
  kind: 'move';
  origin: Point;
  nodes: SceneNode[];
  nodeOrigins: Map<SceneNode, Point>;
  /** Snapshot of each positioned external label's top-left, keyed by its owner. */
  labelOrigins: Map<SceneNode, Point>;
  edges: SceneEdge[];
  edgeOrigins: Map<SceneEdge, Point[]>;
  follow: Map<SceneEdge, EdgeFollow>;
}

interface ResizeState {
  kind: 'resize';
  origin: Point;
  node: SceneNode;
  handle: ResizeHandle;
  bounds: Bounds;
  /** Snapshot of the node's positioned external label's top-left, if it has one. */
  labelOrigin?: Point;
  edges: SceneEdge[];
  edgeOrigins: Map<SceneEdge, Point[]>;
}

interface WaypointState {
  kind: 'waypoint';
  origin: Point;
  edge: SceneEdge;
  index: number;
  original: Point[];
}

type DragState = MoveState | ResizeState | WaypointState;

/**
 * The point on `node`'s outline in the direction of `towards` — the segment from the
 * node centre to `towards`, clipped to the (axis-aligned) bounds. Used to re-dock an
 * edge endpoint after its node is resized.
 */
export function dockingPoint(node: SceneNode, towards: Point): Point {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = node.width / 2;
  const hh = node.height / 2;
  const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  if (!Number.isFinite(t)) return { x: cx, y: cy };
  return { x: cx + dx * t, y: cy + dy * t };
}

/** `value` rounded to the nearest multiple of `step` (a non-positive step is a no-op). */
export function snapTo(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

/**
 * The top-left of `node`'s external label when the document positions it explicitly
 * (`bpmndi:BPMNLabel` with a `dc:Bounds`). An unpositioned label is derived from the
 * owner by the renderer, so it follows a gesture for free and is not snapshotted.
 */
function labelOrigin(node: SceneNode): Point | undefined {
  const label = node.label;
  return label && label.x !== undefined && label.y !== undefined
    ? { x: label.x, y: label.y }
    : undefined;
}

/** Place `node`'s external label at `(x, y)` when it is explicitly positioned. */
function placeLabel(node: SceneNode, x: number, y: number): void {
  const label = node.label;
  if (!label || label.x === undefined || label.y === undefined) return;
  label.x = x;
  label.y = y;
}

/** `nodes` plus every node nested inside them, de-duplicated, ancestors first. */
export function withDescendants(nodes: readonly SceneNode[]): SceneNode[] {
  const out: SceneNode[] = [];
  const seen = new Set<SceneNode>();
  const visit = (node: SceneNode): void => {
    if (seen.has(node)) return;
    seen.add(node);
    out.push(node);
    for (const child of node.children) if (child.kind === 'node') visit(child);
  };
  for (const node of nodes) visit(node);
  return out;
}

/** Runs one pointer gesture at a time and commits it through {@link Writeback}. */
export class Drag {
  private readonly writeback: Writeback;
  private readonly redraw: (elements: SceneElement[]) => void;
  private readonly gridSize: number;
  private readonly minSize: number;
  private snap: boolean;
  private state?: DragState;

  constructor(options: DragOptions) {
    this.writeback = options.writeback;
    this.redraw = options.redraw;
    this.gridSize = options.gridSize ?? DEFAULT_GRID_SIZE;
    this.minSize = options.minSize ?? DEFAULT_MIN_SIZE;
    this.snap = options.snapToGrid ?? false;
  }

  /** Whether a gesture is currently in flight. */
  isActive(): boolean {
    return this.state !== undefined;
  }

  /** The kind of gesture in flight, if any. */
  getKind(): DragKind | undefined {
    return this.state?.kind;
  }

  /** Turn grid snapping on/off (design §3 "optional grid snap behind a flag"). */
  setSnapToGrid(on: boolean): void {
    this.snap = on;
  }

  /** Whether grid snapping is on. */
  isSnapToGrid(): boolean {
    return this.snap;
  }

  /**
   * Begin moving `nodes` (their nested children come along) from diagram point
   * `origin`. Returns `false` when there is nothing movable.
   */
  startMove(nodes: readonly SceneNode[], origin: Point): boolean {
    this.state = undefined;
    const moving = withDescendants(nodes);
    if (moving.length === 0) return false;

    const movingSet = new Set(moving);
    const nodeOrigins = new Map<SceneNode, Point>();
    const labelOrigins = new Map<SceneNode, Point>();
    for (const node of moving) {
      nodeOrigins.set(node, { x: node.x, y: node.y });
      const origin = labelOrigin(node);
      if (origin) labelOrigins.set(node, origin);
    }

    const edges: SceneEdge[] = [];
    const edgeOrigins = new Map<SceneEdge, Point[]>();
    const follow = new Map<SceneEdge, EdgeFollow>();
    for (const node of moving) {
      for (const edge of [...node.outgoing, ...node.incoming]) {
        if (edgeOrigins.has(edge)) continue;
        const sourceMoving = !!edge.source && movingSet.has(edge.source);
        const targetMoving = !!edge.target && movingSet.has(edge.target);
        follow.set(edge, sourceMoving && targetMoving ? 'all' : sourceMoving ? 'first' : 'last');
        edgeOrigins.set(edge, edge.waypoints.map((p) => ({ x: p.x, y: p.y })));
        edges.push(edge);
      }
    }

    this.state = {
      kind: 'move',
      origin: { ...origin },
      nodes: moving,
      nodeOrigins,
      labelOrigins,
      edges,
      edgeOrigins,
      follow,
    };
    return true;
  }

  /** Begin resizing `node` from `handle`, anchored at diagram point `origin`. */
  startResize(node: SceneNode, handle: ResizeHandle, origin: Point): boolean {
    const edges: SceneEdge[] = [];
    const edgeOrigins = new Map<SceneEdge, Point[]>();
    for (const edge of [...node.outgoing, ...node.incoming]) {
      if (edgeOrigins.has(edge)) continue;
      edgeOrigins.set(edge, edge.waypoints.map((p) => ({ x: p.x, y: p.y })));
      edges.push(edge);
    }
    this.state = {
      kind: 'resize',
      origin: { ...origin },
      node,
      handle,
      bounds: { x: node.x, y: node.y, width: node.width, height: node.height },
      ...(labelOrigin(node) ? { labelOrigin: labelOrigin(node) } : {}),
      edges,
      edgeOrigins,
    };
    return true;
  }

  /** Begin dragging waypoint `index` of `edge` (an endpoint included). */
  startWaypoint(edge: SceneEdge, index: number, origin: Point): boolean {
    if (index < 0 || index >= edge.waypoints.length) return false;
    this.state = {
      kind: 'waypoint',
      origin: { ...origin },
      edge,
      index,
      original: edge.waypoints.map((p) => ({ x: p.x, y: p.y })),
    };
    return true;
  }

  /**
   * Apply the gesture for a pointer now at diagram `point`: mutate the scene from the
   * original snapshot and redraw. The DI is NOT touched until {@link Drag.end}.
   */
  update(point: Point): SceneElement[] {
    const state = this.state;
    if (!state) return [];
    const dx = point.x - state.origin.x;
    const dy = point.y - state.origin.y;
    const changed = state.kind === 'move'
      ? this.applyMove(state, dx, dy)
      : state.kind === 'resize'
        ? this.applyResize(state, dx, dy)
        : this.applyWaypoint(state, dx, dy);
    this.redraw(changed);
    return changed;
  }

  /**
   * Finish the gesture at diagram `point`: apply it one last time, then commit the
   * scene geometry through to the DI moddle objects (bumping the scene revision and
   * firing `element.changed` / `elements.changed`). Returns the changed elements.
   */
  end(point: Point): SceneElement[] {
    if (!this.state) return [];
    const changed = this.update(point);
    this.state = undefined;
    if (changed.length > 0) this.writeback.commit(changed);
    return changed;
  }

  /** Abandon the gesture, restoring the snapshot. The DI was never written. */
  cancel(): SceneElement[] {
    const state = this.state;
    if (!state) return [];
    this.state = undefined;
    const changed = state.kind === 'move'
      ? this.applyMove(state, 0, 0)
      : state.kind === 'resize'
        ? this.applyResize(state, 0, 0)
        : this.applyWaypoint(state, 0, 0);
    this.redraw(changed);
    return changed;
  }

  // --- gesture math ---------------------------------------------------------

  private maybeSnap(value: number): number {
    return this.snap ? snapTo(value, this.gridSize) : value;
  }

  private applyMove(state: MoveState, rawDx: number, rawDy: number): SceneElement[] {
    let dx = rawDx;
    let dy = rawDy;
    if (this.snap) {
      // Snap the *lead* node's new origin, then move the whole set by that delta so
      // relative offsets inside a multi-selection survive.
      const lead = state.nodes[0];
      const from = state.nodeOrigins.get(lead) ?? { x: lead.x, y: lead.y };
      dx = snapTo(from.x + rawDx, this.gridSize) - from.x;
      dy = snapTo(from.y + rawDy, this.gridSize) - from.y;
    }

    for (const node of state.nodes) {
      const from = state.nodeOrigins.get(node);
      if (!from) continue;
      node.x = from.x + dx;
      node.y = from.y + dy;
      // An external label is positioned in diagram coordinates, so it must be
      // translated explicitly or it detaches from its shape on the first frame.
      const label = state.labelOrigins.get(node);
      if (label) placeLabel(node, label.x + dx, label.y + dy);
    }

    for (const edge of state.edges) {
      const original = state.edgeOrigins.get(edge);
      if (!original || original.length === 0) continue;
      const mode = state.follow.get(edge) ?? 'last';
      if (mode === 'all') {
        edge.waypoints = original.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        continue;
      }
      const points = original.map((p) => ({ x: p.x, y: p.y }));
      const index = mode === 'first' ? 0 : points.length - 1;
      points[index] = { x: original[index].x + dx, y: original[index].y + dy };
      edge.waypoints = points;
    }

    return [...state.nodes, ...state.edges];
  }

  private applyResize(state: ResizeState, dx: number, dy: number): SceneElement[] {
    const { bounds, handle, node } = state;
    let left = bounds.x;
    let top = bounds.y;
    let right = bounds.x + bounds.width;
    let bottom = bounds.y + bounds.height;

    if (handle.includes('w')) left = this.maybeSnap(bounds.x + dx);
    if (handle.includes('e')) right = this.maybeSnap(bounds.x + bounds.width + dx);
    if (handle.includes('n')) top = this.maybeSnap(bounds.y + dy);
    if (handle.includes('s')) bottom = this.maybeSnap(bounds.y + bounds.height + dy);

    // Clamp against the minimum, holding the anchored (un-dragged) edge fixed.
    if (right - left < this.minSize) {
      if (handle.includes('w')) left = right - this.minSize;
      else right = left + this.minSize;
    }
    if (bottom - top < this.minSize) {
      if (handle.includes('n')) top = bottom - this.minSize;
      else bottom = top + this.minSize;
    }

    node.x = left;
    node.y = top;
    node.width = right - left;
    node.height = bottom - top;

    // Re-anchor an external label: it keeps its offset from the shape's CENTRE, so a
    // handle that drags one side moves the label by half that amount and a symmetric
    // resize leaves it where it was.
    const anchor = state.labelOrigin;
    if (anchor) {
      const dcx = node.x + node.width / 2 - (bounds.x + bounds.width / 2);
      const dcy = node.y + node.height / 2 - (bounds.y + bounds.height / 2);
      placeLabel(node, anchor.x + dcx, anchor.y + dcy);
    }

    for (const edge of state.edges) {
      const original = state.edgeOrigins.get(edge);
      if (!original || original.length === 0) continue;
      const points = original.map((p) => ({ x: p.x, y: p.y }));
      const last = points.length - 1;
      if (edge.source === node) points[0] = dockingPoint(node, original[1] ?? original[0]);
      if (edge.target === node) points[last] = dockingPoint(node, original[last - 1] ?? original[last]);
      edge.waypoints = points;
    }

    return [node, ...state.edges];
  }

  private applyWaypoint(state: WaypointState, dx: number, dy: number): SceneElement[] {
    const points = state.original.map((p) => ({ x: p.x, y: p.y }));
    const from = state.original[state.index];
    points[state.index] = {
      x: this.maybeSnap(from.x + dx),
      y: this.maybeSnap(from.y + dy),
    };
    state.edge.waypoints = points;
    return [state.edge];
  }
}
