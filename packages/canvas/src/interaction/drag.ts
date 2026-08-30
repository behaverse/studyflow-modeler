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
 * Connected edges follow their node:
 *
 * - **move** — the docking waypoint is translated by the same delta and the edge is
 *   then RE-ROUTED orthogonally on every frame (parity spec addendum 2 §3: the
 *   reference draws its connections live, so the S-bend grows as the shape travels
 *   rather than appearing at the drop). An edge whose *both* endpoints move
 *   translates every waypoint instead, so a whole moved sub-graph keeps its shape.
 *   The re-route touches only `edge.waypoints`; the DI is written on {@link Drag.end}
 *   like everything else.
 * - **resize** — the docking waypoint is re-docked to the new outline via
 *   `routing/crop.ts` `cropPoint`: the segment from the node centre toward the
 *   neighbouring waypoint, clipped to the SILHOUETTE, so an endpoint on a gateway
 *   lands on the rhombus and not on its bounding box.
 *
 * An explicitly positioned external label (`bpmndi:BPMNLabel` with a `dc:Bounds`)
 * rides along with its shape — translated by the move delta, re-anchored to the shape
 * centre on resize — and is written back with it (`model/writeback.ts`).
 *
 * A label can also travel ON ITS OWN ({@link Drag.startLabel}, parity spec addendum
 * 3): the caption is dragged away from the element it names, the owner does not move,
 * and the drop writes the label's `bpmndi:BPMNLabel` and nothing else.
 */

import type {
  Bounds,
  Point,
  SceneEdge,
  SceneElement,
  SceneNode,
} from '@canvas/model/scene.ts';
import { dropSceneLabel, ensureSceneLabel, type Writeback } from '@canvas/model/writeback.ts';
import type { ResizeHandle } from '@canvas/interaction/selection.ts';
import {
  freeMoveEnd,
  moveBendpoint,
  moveSegment,
  segmentsOf,
  type SegmentShapes,
} from '@canvas/interaction/segments.ts';
import { rerouteEdge } from '@canvas/routing/orthogonal.ts';
import { cropPoint } from '@canvas/routing/crop.ts';

/** Grid step used when snapping is enabled. */
export const DEFAULT_GRID_SIZE = 10;

/** Smallest width/height a resize gesture may produce (diagram units). */
export const DEFAULT_MIN_SIZE = 20;

/** A width/height floor for one resize gesture (mirrors `rules/rules.ts` `Size`). */
export interface MinSize {
  width: number;
  height: number;
}

/** Which gesture is in flight. */
export type DragKind = 'move' | 'resize' | 'waypoint' | 'segment' | 'label';

/**
 * Which axes one gesture frame may still grid-snap.
 *
 * Grid snapping is not the only snap in play: `Canvas.snapGesture` runs
 * ELEMENT-ALIGNMENT snapping first, and an axis that alignment already claimed must
 * not then be rounded off it (parity spec addendum 7: "alignment wins within its
 * threshold, grid otherwise"). The caller reports the axes it left alone; both are
 * open by default, which is what an unassisted gesture wants.
 */
export interface GridAxes {
  x: boolean;
  y: boolean;
}

/** Neither axis claimed by another snap — the default for {@link Drag.update}. */
const BOTH_AXES: GridAxes = { x: true, y: true };

/** Construction dependencies for {@link Drag}. */
export interface DragOptions {
  /** Applies the committed scene geometry to the DI moddle objects. */
  writeback: Writeback;
  /** Redraw these elements' graphics (live feedback during the gesture). */
  redraw: (elements: SceneElement[]) => void;
  /**
   * Snap edited coordinates to {@link DragOptions.gridSize}. Default `true` —
   * diagram-js grid-snaps every move, resize, create and waypoint drag out of the
   * box, and parity spec addendum 7 makes that this canvas's default too. Pass
   * `false` (or call {@link Drag.setSnapToGrid}) to drag freely.
   */
  snapToGrid?: boolean;
  /** Grid step for snapping. Default {@link DEFAULT_GRID_SIZE}. */
  gridSize?: number;
  /** Minimum node width/height on resize. Default {@link DEFAULT_MIN_SIZE}. */
  minSize?: number;
  /**
   * Per-node width/height floor, resolved once per resize gesture — the rules'
   * `minSizeFor` (a pool is 300×60, an activity 100×80, a text annotation 50×30),
   * which is what `Rules.canResize` would judge the resulting bounds against.
   * Falls back to the single {@link DragOptions.minSize} number when absent.
   */
  minSizeFor?: (node: SceneNode) => MinSize;
}

/** How a followed edge reacts to its node moving. */
type EdgeFollow = 'all' | 'first' | 'last';

interface MoveState {
  kind: 'move';
  origin: Point;
  /**
   * Whether THIS move grid-snaps, captured at the start. A keyboard nudge opts out
   * (`Canvas.nudgeSelection`): its whole point is a 1-unit step, which rounding to
   * the 10-unit grid would swallow entirely.
   */
  snap: boolean;
  /**
   * Whether connected edges are re-laid-out as the move runs. A keyboard nudge opts
   * out of this too: re-routing is what a DRAG shows the user (the flows visibly
   * reshape under the ghost), whereas discarding a hand-shaped route because someone
   * pressed an arrow key once would be a surprise, not feedback.
   */
  reroute: boolean;
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
  /** Width/height floor for THIS gesture (see {@link DragOptions.minSizeFor}). */
  min: MinSize;
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
  /**
   * The geometry the gesture opened with — WITHOUT the joint an `insert` drag adds,
   * so cancelling restores the connection the document still has and a drag that
   * changed nothing commits nothing.
   */
  original: Point[];
  /** Whether `index` is a joint this gesture mints at {@link WaypointState.origin}. */
  insert: boolean;
}

/** A whole straight run sliding perpendicular to itself (parity spec §2/§3). */
interface SegmentState {
  kind: 'segment';
  origin: Point;
  edge: SceneEdge;
  /** Index of the run's FIRST waypoint. */
  index: number;
  original: Point[];
  /** Which way the run travels: a horizontal run moves on `y`, a vertical one on `x`. */
  axis: 'h' | 'v';
}

/**
 * An external LABEL travelling on its own, away from the element it names (parity
 * spec addendum 3 §2). The gesture carries the synthetic label element
 * (`model/externalLabel.ts`) so the overlay's leader line and chips can follow it
 * live, and commits through {@link Writeback.setLabelBounds}, which writes the
 * label's `bpmndi:BPMNLabel` and NOTHING else.
 */
interface LabelState {
  kind: 'label';
  origin: Point;
  /** The synthetic element the caption is selected and dragged as. */
  label: SceneNode;
  /** The node or connection the caption names. */
  owner: SceneElement;
  /** The caption's diagram-space text box when the gesture began. */
  bounds: Bounds;
  /**
   * Whether THIS gesture minted the owner's {@link SceneLabel} (the document
   * positioned no label before). Escape has to take that back, or an abandoned drag
   * would leave a caption that has quietly stopped being derived from its owner.
   */
  minted: boolean;
}

type DragState = MoveState | ResizeState | WaypointState | SegmentState | LabelState;

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
  private readonly minSizeOf?: (node: SceneNode) => MinSize;
  private snap: boolean;
  private state?: DragState;
  /** Axes the current frame may grid-snap (see {@link GridAxes}). */
  private axes: GridAxes = BOTH_AXES;

  constructor(options: DragOptions) {
    this.writeback = options.writeback;
    this.redraw = options.redraw;
    this.gridSize = options.gridSize ?? DEFAULT_GRID_SIZE;
    this.minSize = options.minSize ?? DEFAULT_MIN_SIZE;
    this.minSizeOf = options.minSizeFor;
    this.snap = options.snapToGrid ?? true;
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
   *
   * `options` overrides what this ONE gesture does — the escape hatch a keyboard
   * nudge needs, where a 1-unit step must survive the grid and a hand-shaped route
   * must survive the arrow key.
   */
  startMove(
    nodes: readonly SceneNode[],
    origin: Point,
    options?: { snapToGrid?: boolean; rerouteEdges?: boolean },
  ): boolean {
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
      snap: options?.snapToGrid ?? this.snap,
      reroute: options?.rerouteEdges ?? true,
      nodes: moving,
      nodeOrigins,
      labelOrigins,
      edges,
      edgeOrigins,
      follow,
    };
    return true;
  }

  /**
   * Begin resizing `node` from `handle`, anchored at diagram point `origin`. The
   * width/height floor is resolved HERE, once, from
   * {@link DragOptions.minSizeFor} — a caller may override it per gesture with
   * `min` (the rules' verdict for this very node, `Canvas.startDrag`).
   *
   * Whether the node may be resized AT ALL is the caller's question
   * (`Rules.canResize`): this is the gesture runner, not the rule engine.
   */
  startResize(node: SceneNode, handle: ResizeHandle, origin: Point, min?: MinSize): boolean {
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
      min: min ?? this.minSizeOf?.(node) ?? { width: this.minSize, height: this.minSize },
      ...(labelOrigin(node) ? { labelOrigin: labelOrigin(node) } : {}),
      edges,
      edgeOrigins,
    };
    return true;
  }

  /**
   * Begin dragging waypoint `index` of `edge` (an endpoint included).
   *
   * With `insert` the joint does not exist yet: `index` is where it goes and
   * `origin` — the press, a point on the connection's own line — is where it starts,
   * which is diagram-js's floating bendpoint. Nothing is inserted until the gesture
   * moves, because the insertion is re-derived from the snapshot on every frame.
   */
  startWaypoint(edge: SceneEdge, index: number, origin: Point, insert = false): boolean {
    const limit = edge.waypoints.length + (insert ? 1 : 0);
    if (index < 0 || index >= limit) return false;
    if (insert && (index < 1 || index > edge.waypoints.length - 1)) return false;
    this.state = {
      kind: 'waypoint',
      origin: { ...origin },
      edge,
      index,
      original: edge.waypoints.map((p) => ({ x: p.x, y: p.y })),
      insert,
    };
    return true;
  }

  /**
   * Begin sliding the straight run that STARTS at waypoint `index` of `edge`
   * (parity spec §2 segment move, §3 add-bendpoint-by-drag — diagram-js routes both
   * through the same `ConnectionSegmentMove`). Returns `false` when `index` names
   * no run.
   */
  startSegment(edge: SceneEdge, index: number, origin: Point): boolean {
    this.state = undefined;
    const segment = segmentsOf(edge.waypoints).find((s) => s.index === index);
    if (!segment) return false;
    this.state = {
      kind: 'segment',
      origin: { ...origin },
      edge,
      index,
      original: edge.waypoints.map((p) => ({ x: p.x, y: p.y })),
      axis: segment.axis,
    };
    return true;
  }

  /**
   * Begin dragging an external LABEL — the synthetic element
   * `model/externalLabel.ts` mints for a caption (parity spec addendum 3 §2). The
   * caption travels alone: its owner does not move, and the only thing the drop
   * writes is the label's own `bpmndi:BPMNLabel/dc:Bounds`.
   *
   * A caption the document never positioned is made explicit here, in the SCENE
   * only ({@link ensureSceneLabel}), so the very first frame starts from the box the
   * renderer is already drawing. Returns `false` for anything that is not a label.
   */
  startLabel(label: SceneNode, origin: Point): boolean {
    this.state = undefined;
    const owner = label.labelTarget;
    if (!owner) return false;
    const bounds: Bounds = {
      x: label.x,
      y: label.y,
      width: label.width,
      height: label.height,
    };
    const minted = !owner.label;
    ensureSceneLabel(owner, bounds);
    this.state = { kind: 'label', origin: { ...origin }, label, owner, bounds, minted };
    return true;
  }

  /**
   * Apply the gesture for a pointer now at diagram `point`: mutate the scene from the
   * original snapshot and redraw. The DI is NOT touched until {@link Drag.end}.
   *
   * `grid` names the axes this frame may still round to the grid; an axis the caller
   * already snapped to a neighbour's alignment is left exactly where it put it.
   */
  update(point: Point, grid: GridAxes = BOTH_AXES): SceneElement[] {
    const state = this.state;
    if (!state) return [];
    this.axes = grid;
    const dx = point.x - state.origin.x;
    const dy = point.y - state.origin.y;
    const changed = state.kind === 'move'
      ? this.applyMove(state, dx, dy)
      : state.kind === 'resize'
        ? this.applyResize(state, dx, dy)
        : state.kind === 'segment'
          ? this.applySegment(state, dx, dy)
          : state.kind === 'label'
            ? this.applyLabel(state, dx, dy)
            : this.applyWaypoint(state, dx, dy);
    this.redraw(changed);
    return changed;
  }

  /**
   * Finish the gesture at diagram `point`: apply it one last time, then commit the
   * scene geometry through to the DI moddle objects (bumping the scene revision and
   * firing `element.changed` / `elements.changed`). Returns what was committed.
   *
   * Only what actually MOVED is committed. A move gesture carries every descendant
   * of the dragged shape plus every incident edge — dragging a 30-lane pool one grid
   * step and back would otherwise rewrite the DI of all thirty and fire a change per
   * element for a document that is byte-identical. The live frames still redraw the
   * whole set (see {@link Drag.update}); it is the DI write that is narrowed.
   */
  end(point: Point, grid: GridAxes = BOTH_AXES): SceneElement[] {
    const state = this.state;
    if (!state) return [];
    const touched = this.update(point, grid);
    this.state = undefined;
    // A label commits through its OWN writeback call: `commit` would write the
    // owner's `dc:Bounds`/`di:waypoint` too, and a caption move must leave both
    // exactly as the document has them (parity spec addendum 3 §5).
    if (state.kind === 'label') {
      this.writeback.setLabelBounds(state.owner, currentLabelBounds(state));
      return touched;
    }
    const changed = touched.filter((element) => movedFrom(state, element));
    if (changed.length > 0) this.writeback.commit(changed);
    return changed;
  }

  /**
   * Abandon the gesture, restoring the snapshot VERBATIM. The DI was never written,
   * so the scene must land back on exactly the geometry the document still holds —
   * which is why this assigns the snapshot back rather than replaying the gesture
   * with a zero delta: with {@link Drag.setSnapToGrid} on, every applier snaps
   * *after* adding the delta, so a zero delta is not the identity and Escape would
   * move a shape imported off-grid (x=137 → 140) while the DI kept saying 137.
   */
  cancel(): SceneElement[] {
    const state = this.state;
    if (!state) return [];
    this.state = undefined;
    const changed = state.kind === 'move'
      ? restoreMove(state)
      : state.kind === 'resize'
        ? restoreResize(state)
        : state.kind === 'label'
          ? restoreLabel(state)
          : restoreWaypoint(state);
    this.redraw(changed);
    return changed;
  }

  /** The shapes an edge gesture re-docks against (a dangling end contributes none). */
  private shapesOf(edge: SceneEdge): SegmentShapes {
    return {
      ...(edge.source ? { source: edge.source } : {}),
      ...(edge.target ? { target: edge.target } : {}),
    };
  }

  // --- gesture math ---------------------------------------------------------

  /** Grid-snap `value` on `axis`, unless snapping is off or the axis is spoken for. */
  private maybeSnap(value: number, axis: 'x' | 'y'): number {
    return this.snap && this.axes[axis] ? snapTo(value, this.gridSize) : value;
  }

  private applyMove(state: MoveState, rawDx: number, rawDy: number): SceneElement[] {
    let dx = rawDx;
    let dy = rawDy;
    if (state.snap) {
      // Snap the *lead* node's new origin, then move the whole set by that delta so
      // relative offsets inside a multi-selection survive.
      const lead = state.nodes[0];
      const from = state.nodeOrigins.get(lead) ?? { x: lead.x, y: lead.y };
      if (this.axes.x) dx = snapTo(from.x + rawDx, this.gridSize) - from.x;
      if (this.axes.y) dy = snapTo(from.y + rawDy, this.gridSize) - from.y;
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
      if (!state.reroute) continue;
      // …then lay the whole run out again (parity spec addendum 2 §3+§5): the
      // reference re-routes live, so the elbow forms while the shape is still in
      // flight and the drop commits exactly what was on screen. Dragging the docking
      // point first is not redundant — it is what a DANGLING edge (no source or no
      // target, which the router declines) falls back to.
      rerouteEdge(edge);
    }

    return [...state.nodes, ...state.edges];
  }

  private applyResize(state: ResizeState, dx: number, dy: number): SceneElement[] {
    const { bounds, handle, node } = state;
    let left = bounds.x;
    let top = bounds.y;
    let right = bounds.x + bounds.width;
    let bottom = bounds.y + bounds.height;

    if (handle.includes('w')) left = this.maybeSnap(bounds.x + dx, 'x');
    if (handle.includes('e')) right = this.maybeSnap(bounds.x + bounds.width + dx, 'x');
    if (handle.includes('n')) top = this.maybeSnap(bounds.y + dy, 'y');
    if (handle.includes('s')) bottom = this.maybeSnap(bounds.y + bounds.height + dy, 'y');

    // Clamp against this node's own floor, holding the anchored (un-dragged) edge
    // fixed. The floor is per-type (`rules/rules.ts` `minSizeFor`), so a pool cannot
    // be dragged under 300×60 and leave its lanes overhanging.
    const min = state.min;
    if (right - left < min.width) {
      if (handle.includes('w')) left = right - min.width;
      else right = left + min.width;
    }
    if (bottom - top < min.height) {
      if (handle.includes('n')) top = bottom - min.height;
      else bottom = top + min.height;
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
      if (edge.source === node) points[0] = cropPoint(node, original[1] ?? original[0]);
      if (edge.target === node) points[last] = cropPoint(node, original[last - 1] ?? original[last]);
      edge.waypoints = points;
    }

    return [node, ...state.edges];
  }

  private applyWaypoint(state: WaypointState, dx: number, dy: number): SceneElement[] {
    // An insert drag works on the snapshot WITH its new joint spliced in — rebuilt
    // every frame, so the gesture stays a pure function of the original geometry.
    const base = state.insert
      ? [
        ...state.original.slice(0, state.index),
        { ...state.origin },
        ...state.original.slice(state.index),
      ]
      : state.original;
    const from = base[state.index];
    const to = { x: this.maybeSnap(from.x + dx, 'x'), y: this.maybeSnap(from.y + dy, 'y') };
    const terminal = state.index === 0 || state.index === base.length - 1;
    if (terminal) {
      // An ENDPOINT drag that got this far was dropped clear of every shape, so it
      // is the free endpoint move: the tip goes exactly where the pointer is
      // (parity spec §1) and the route reaches it squarely (§4).
      state.edge.waypoints = freeMoveEnd(
        base,
        state.index === 0 ? 'source' : 'target',
        to,
      );
      return [state.edge];
    }
    // A BENDPOINT drag moves just that joint: the neighbours stay put and the two
    // runs meeting it bend diagonal when that is where the pointer went — only the
    // docks are re-cropped to their shapes.
    state.edge.waypoints = moveBendpoint(
      base,
      state.index,
      to,
      this.shapesOf(state.edge),
    );
    return [state.edge];
  }

  /**
   * Slide a whole run perpendicular to itself. The pointer's motion ALONG the run is
   * discarded (a segment cannot travel down its own line) and only the perpendicular
   * component survives — grid-snapped, when snapping is on, on that axis alone, so a
   * horizontal run lands on a grid `y` without its `x` extent being quantized.
   */
  /**
   * Slide a caption to a new box. Only the label moves: the owner keeps its bounds
   * and its waypoints, and the element that is redrawn is the owner purely because
   * the caption is drawn INSIDE the owner's `<g>` (`render/labels.ts`).
   *
   * The synthetic label element is kept in step as well, so the selection overlay's
   * dashed leader and chips track the caption on every frame rather than waiting for
   * the next `ExternalLabels.of` refresh.
   */
  private applyLabel(state: LabelState, dx: number, dy: number): SceneElement[] {
    const x = this.maybeSnap(state.bounds.x + dx, 'x');
    const y = this.maybeSnap(state.bounds.y + dy, 'y');
    const label = state.owner.label;
    if (label) {
      label.x = x;
      label.y = y;
      // The stored box is normalized to the box the glyphs actually cover. The
      // renderer CENTRES the text inside whatever region the DI names
      // (`render/labels.ts` `externalLabelLayout`), so a region wider than its text
      // would drift the caption by half the difference on every frame — the label
      // would not keep up with the cursor. bpmn-js re-fits its label bounds to the
      // text on a move for the same reason.
      label.width = state.bounds.width;
      label.height = state.bounds.height;
    }
    state.label.x = x;
    state.label.y = y;
    return [state.owner];
  }

  private applySegment(state: SegmentState, dx: number, dy: number): SceneElement[] {
    const from = state.original[state.index];
    const delta = state.axis === 'h'
      ? { x: 0, y: this.maybeSnap(from.y + dy, 'y') - from.y }
      : { x: this.maybeSnap(from.x + dx, 'x') - from.x, y: 0 };
    state.edge.waypoints = moveSegment(
      state.original,
      state.index,
      delta,
      this.shapesOf(state.edge),
    );
    return [state.edge];
  }
}

// --- what actually moved (Drag.end) -----------------------------------------

/**
 * Whether `element`'s geometry differs from the snapshot the gesture opened with.
 * Read against the SAME maps {@link Drag.cancel} restores from, so "unchanged" here
 * means exactly "restoring it would be a no-op". An element the gesture kept no
 * snapshot for counts as changed — the safe answer, since it cannot be proven still.
 */
function movedFrom(state: DragState, element: SceneElement): boolean {
  if (element.kind === 'edge') {
    const original = state.kind === 'move' || state.kind === 'resize'
      ? state.edgeOrigins.get(element)
      : state.kind === 'waypoint' || state.kind === 'segment'
        ? state.original
        : undefined;
    return !original || !samePoints(original, element.waypoints);
  }
  if (state.kind === 'move') {
    const from = state.nodeOrigins.get(element);
    return !from || from.x !== element.x || from.y !== element.y;
  }
  if (state.kind === 'resize') {
    const b = state.bounds;
    return b.x !== element.x || b.y !== element.y
      || b.width !== element.width || b.height !== element.height;
  }
  return true;
}

/** Point-by-point equality of two polylines. */
function samePoints(a: readonly Point[], b: readonly Point[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].x !== b[i].x || a[i].y !== b[i].y) return false;
  }
  return true;
}

// --- snapshot restore (Drag.cancel) -----------------------------------------
//
// Deliberately NOT expressed as "apply the gesture with a zero delta": these assign
// the snapshotted geometry straight back, which is the only formulation that is
// exact under grid snapping. Each returns the elements to redraw.

function restoreMove(state: MoveState): SceneElement[] {
  for (const node of state.nodes) {
    const from = state.nodeOrigins.get(node);
    if (!from) continue;
    node.x = from.x;
    node.y = from.y;
    const label = state.labelOrigins.get(node);
    if (label) placeLabel(node, label.x, label.y);
  }
  for (const edge of state.edges) {
    const original = state.edgeOrigins.get(edge);
    if (original) edge.waypoints = original.map((p) => ({ x: p.x, y: p.y }));
  }
  return [...state.nodes, ...state.edges];
}

function restoreResize(state: ResizeState): SceneElement[] {
  const { bounds, node } = state;
  node.x = bounds.x;
  node.y = bounds.y;
  node.width = bounds.width;
  node.height = bounds.height;
  if (state.labelOrigin) placeLabel(node, state.labelOrigin.x, state.labelOrigin.y);
  for (const edge of state.edges) {
    const original = state.edgeOrigins.get(edge);
    if (original) edge.waypoints = original.map((p) => ({ x: p.x, y: p.y }));
  }
  return [node, ...state.edges];
}

function restoreWaypoint(state: WaypointState | SegmentState): SceneElement[] {
  state.edge.waypoints = state.original.map((p) => ({ x: p.x, y: p.y }));
  return [state.edge];
}

/** The caption's box as the live scene now has it (what the drop commits). */
function currentLabelBounds(state: LabelState): Bounds {
  const label = state.owner.label;
  return {
    x: label?.x ?? state.label.x,
    y: label?.y ?? state.label.y,
    width: label?.width ?? state.label.width,
    height: label?.height ?? state.label.height,
  };
}

function restoreLabel(state: LabelState): SceneElement[] {
  const label = state.owner.label;
  if (label) {
    label.x = state.bounds.x;
    label.y = state.bounds.y;
  }
  state.label.x = state.bounds.x;
  state.label.y = state.bounds.y;
  // A label this gesture invented goes away with it: the DI never learned of it, so
  // leaving it behind would silently pin a caption the document still derives.
  if (state.minted) dropSceneLabel(state.owner);
  return [state.owner];
}
