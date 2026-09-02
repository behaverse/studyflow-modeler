/**
 * Move, resize and waypoint drags. A gesture snapshots the original geometry,
 * re-derives every frame from that snapshot plus the total pointer delta, and
 * commits through the mutator on release. Cancel restores the snapshot.
 */

import type { Mutator } from '@canvas/model/mutator.ts';
import type { Bounds, Point, SceneEdge, SceneElement, SceneLabel, SceneNode } from '@canvas/model/scene.ts';
import { nameOf } from '@canvas/model/moddle.ts';
import { visibleEndpointOf, withDescendants } from '@canvas/model/tree.ts';
import { labelHeightFor, labelMinSize } from '@canvas/render/labels.ts';
import { cropPoint } from '@canvas/routing/crop.ts';
import { freeMoveEnd, moveBendpoint, moveTerminal } from '@canvas/routing/edit.ts';
import { orthogonalize, rerouteEdge } from '@canvas/routing/orthogonal.ts';
import type { ResizeHandle } from '@canvas/interaction/selection.ts';

export const DEFAULT_GRID_SIZE = 10;
export const DEFAULT_MIN_SIZE = 20;

export type DragKind = 'move' | 'resize' | 'waypoint';
export type Movable = SceneNode | SceneLabel;

/** Which axes a frame may still grid-snap (an axis alignment already claimed is left alone). */
export interface GridAxes {
  x: boolean;
  y: boolean;
}

const BOTH_AXES: GridAxes = { x: true, y: true };

export interface MinSize {
  width: number;
  height: number;
}

export interface DragOptions {
  mutator: Mutator;
  redraw: (elements: SceneElement[]) => void;
  snapToGrid?: boolean;
  gridSize?: number;
  minSizeFor?: (node: SceneNode) => MinSize;
  /** Boxes a live re-route steers around, asked once per move. */
  obstacles?: (moving: readonly SceneNode[]) => Bounds[];
  getScope?: () => SceneNode | undefined;
}

type EdgeFollow = 'all' | 'first' | 'last';

interface MoveState {
  kind: 'move';
  origin: Point;
  snap: boolean;
  reroute: boolean;
  obstacles: Bounds[];
  nodes: SceneNode[];
  nodeOrigins: Map<SceneNode, Point>;
  /** Pinned captions travelling with their nodes, and captions dragged on their own. */
  labels: SceneLabel[];
  labelOrigins: Map<SceneLabel, Point>;
  /** Captions dragged on their own: pinned on drop. */
  loose: SceneLabel[];
  edges: SceneEdge[];
  edgeOrigins: Map<SceneEdge, Point[]>;
  follow: Map<SceneEdge, EdgeFollow>;
}

interface ResizeState {
  kind: 'resize';
  origin: Point;
  target: Movable;
  handle: ResizeHandle;
  bounds: Bounds;
  min: MinSize;
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
  /** The joint at `index` does not exist yet; it is spliced in at `origin` on every frame. */
  insert: boolean;
}

type DragState = MoveState | ResizeState | WaypointState;

export function snapTo(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

export class Drag {
  private readonly mutator: Mutator;
  private readonly redraw: (elements: SceneElement[]) => void;
  private readonly gridSize: number;
  private readonly minSizeOf?: (node: SceneNode) => MinSize;
  private readonly obstaclesFor?: (moving: readonly SceneNode[]) => Bounds[];
  private readonly getScope?: () => SceneNode | undefined;
  private snap: boolean;
  private state?: DragState;
  private axes: GridAxes = BOTH_AXES;

  constructor(options: DragOptions) {
    this.mutator = options.mutator;
    this.redraw = options.redraw;
    this.gridSize = options.gridSize ?? DEFAULT_GRID_SIZE;
    this.minSizeOf = options.minSizeFor;
    this.snap = options.snapToGrid ?? true;
    this.obstaclesFor = options.obstacles;
    this.getScope = options.getScope;
  }

  isActive(): boolean {
    return this.state !== undefined;
  }

  getKind(): DragKind | undefined {
    return this.state?.kind;
  }

  setSnapToGrid(on: boolean): void {
    this.snap = on;
  }

  isSnapToGrid(): boolean {
    return this.snap;
  }

  /** Begin moving nodes (contents come along) and captions from `origin`. */
  startMove(elements: readonly Movable[], origin: Point, options?: { snapToGrid?: boolean; rerouteEdges?: boolean }): boolean {
    this.state = undefined;
    const nodes = withDescendants(elements.filter((el): el is SceneNode => el.kind === 'node'));
    const nodeSet = new Set(nodes);
    const loose = elements.filter((el): el is SceneLabel => el.kind === 'label' && !(el.owner.kind === 'node' && nodeSet.has(el.owner)));
    if (nodes.length === 0 && loose.length === 0) return false;

    const nodeOrigins = new Map<SceneNode, Point>();
    const labels: SceneLabel[] = [...loose];
    const labelOrigins = new Map<SceneLabel, Point>();
    for (const node of nodes) {
      nodeOrigins.set(node, { x: node.x, y: node.y });
      if (node.label?.pinned) labels.push(node.label);
    }
    const edges: SceneEdge[] = [];
    const edgeOrigins = new Map<SceneEdge, Point[]>();
    const follow = new Map<SceneEdge, EdgeFollow>();
    for (const node of nodes) {
      for (const edge of [...node.outgoing, ...node.incoming]) {
        if (edgeOrigins.has(edge)) continue;
        const sourceMoving = !!edge.source && nodeSet.has(edge.source);
        const targetMoving = !!edge.target && nodeSet.has(edge.target);
        follow.set(edge, sourceMoving && targetMoving ? 'all' : sourceMoving ? 'first' : 'last');
        edgeOrigins.set(edge, edge.waypoints.map((p) => ({ x: p.x, y: p.y })));
        edges.push(edge);
        if (edge.label?.pinned && sourceMoving && targetMoving) labels.push(edge.label);
      }
    }
    for (const label of labels) labelOrigins.set(label, { x: label.x, y: label.y });

    this.state = {
      kind: 'move',
      origin: { ...origin },
      snap: options?.snapToGrid ?? this.snap,
      reroute: options?.rerouteEdges ?? true,
      obstacles: this.obstaclesFor?.(nodes) ?? [],
      nodes,
      nodeOrigins,
      labels,
      labelOrigins,
      loose,
      edges,
      edgeOrigins,
      follow,
    };
    return true;
  }

  startResize(target: Movable, handle: ResizeHandle, origin: Point): boolean {
    this.state = undefined;
    const edges: SceneEdge[] = [];
    const edgeOrigins = new Map<SceneEdge, Point[]>();
    if (target.kind === 'node') {
      for (const edge of [...target.outgoing, ...target.incoming]) {
        if (edgeOrigins.has(edge)) continue;
        edgeOrigins.set(edge, edge.waypoints.map((p) => ({ x: p.x, y: p.y })));
        edges.push(edge);
      }
    }
    const min = target.kind === 'label'
      ? labelMinSize(nameOf(target.businessObject))
      : this.minSizeOf?.(target) ?? { width: DEFAULT_MIN_SIZE, height: DEFAULT_MIN_SIZE };
    const labelOrigin = target.kind === 'node' && target.label?.pinned ? { x: target.label.x, y: target.label.y } : undefined;
    this.state = {
      kind: 'resize',
      origin: { ...origin },
      target,
      handle,
      bounds: { x: target.x, y: target.y, width: target.width, height: target.height },
      min,
      ...(labelOrigin ? { labelOrigin } : {}),
      edges,
      edgeOrigins,
    };
    return true;
  }

  /** Drag waypoint `index` (an endpoint included); `insert` adds the joint at `origin` first. */
  startWaypoint(edge: SceneEdge, index: number, origin: Point, insert = false): boolean {
    this.state = undefined;
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

  update(point: Point, grid: GridAxes = BOTH_AXES): SceneElement[] {
    const state = this.state;
    if (!state) return [];
    this.axes = grid;
    const dx = point.x - state.origin.x;
    const dy = point.y - state.origin.y;
    const changed = state.kind === 'move'
      ? this.applyMove(state, dx, dy)
      : state.kind === 'resize' ? this.applyResize(state, dx, dy) : this.applyWaypoint(state, dx, dy);
    this.redraw(changed);
    return changed;
  }

  /** Apply once more at `point`, then commit what actually moved. */
  end(point: Point, grid: GridAxes = BOTH_AXES): SceneElement[] {
    const state = this.state;
    if (!state) return [];
    const touched = this.update(point, grid);
    this.state = undefined;
    if (state.kind === 'move') for (const label of state.loose) label.pinned = true;
    if (state.kind === 'resize' && state.target.kind === 'label') state.target.pinned = true;
    const changed = touched.filter((element) => movedFrom(state, element));
    this.mutator.commit(changed);
    return changed;
  }

  /** Put the snapshot back verbatim (a zero delta is not the identity under grid snapping). */
  cancel(): SceneElement[] {
    const state = this.state;
    if (!state) return [];
    this.state = undefined;
    const changed = state.kind === 'move'
      ? restoreMove(state)
      : state.kind === 'resize' ? restoreResize(state) : restoreWaypoint(state);
    this.redraw(changed);
    return changed;
  }

  private maybeSnap(value: number, axis: 'x' | 'y'): number {
    return this.snap && this.axes[axis] ? snapTo(value, this.gridSize) : value;
  }

  private applyMove(state: MoveState, rawDx: number, rawDy: number): SceneElement[] {
    let dx = rawDx;
    let dy = rawDy;
    if (state.snap) {
      const lead: Movable | undefined = state.nodes[0] ?? state.loose[0];
      if (lead) {
        const from = lead.kind === 'node' ? state.nodeOrigins.get(lead) : state.labelOrigins.get(lead);
        if (from) {
          if (this.axes.x) dx = snapTo(from.x + rawDx, this.gridSize) - from.x;
          if (this.axes.y) dy = snapTo(from.y + rawDy, this.gridSize) - from.y;
        }
      }
    }
    for (const node of state.nodes) {
      const from = state.nodeOrigins.get(node);
      if (!from) continue;
      node.x = from.x + dx;
      node.y = from.y + dy;
    }
    for (const label of state.labels) {
      const from = state.labelOrigins.get(label);
      if (!from) continue;
      label.x = from.x + dx;
      label.y = from.y + dy;
    }
    const scope = this.getScope?.();
    for (const edge of state.edges) {
      const original = state.edgeOrigins.get(edge);
      if (!original || original.length === 0) continue;
      const mode = state.follow.get(edge) ?? 'last';
      if (mode === 'all') {
        edge.waypoints = original.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        continue;
      }
      const points = original.map((p) => ({ x: p.x, y: p.y }));
      const end: 'source' | 'target' = mode === 'first' ? 'source' : 'target';
      const index = mode === 'first' ? 0 : points.length - 1;
      const shape = mode === 'first' ? edge.source : edge.target;
      const docked = shape && visibleEndpointOf(shape, scope);
      // A route the author bent is re-docked, never re-cut.
      if (state.reroute && points.length > 2 && docked) {
        moveTerminal(points, end, cropPoint(docked, points[index === 0 ? 1 : index - 1]));
        edge.waypoints = orthogonalize(points, undefined, false);
        continue;
      }
      points[index] = { x: original[index].x + dx, y: original[index].y + dy };
      edge.waypoints = points;
      if (state.reroute) rerouteEdge(edge, { obstacles: state.obstacles, scope });
    }
    return [...state.nodes, ...state.edges, ...state.loose];
  }

  private applyResize(state: ResizeState, dx: number, dy: number): SceneElement[] {
    const { bounds, handle, target } = state;
    let left = bounds.x;
    let top = bounds.y;
    let right = bounds.x + bounds.width;
    let bottom = bounds.y + bounds.height;
    if (handle.includes('w')) left = this.maybeSnap(bounds.x + dx, 'x');
    if (handle.includes('e')) right = this.maybeSnap(bounds.x + bounds.width + dx, 'x');
    if (handle.includes('n')) top = this.maybeSnap(bounds.y + dy, 'y');
    if (handle.includes('s')) bottom = this.maybeSnap(bounds.y + bounds.height + dy, 'y');

    const min = state.min;
    if (right - left < min.width) {
      if (handle.includes('w')) left = right - min.width;
      else right = left + min.width;
    }
    let minHeight = min.height;
    if (target.kind === 'label') minHeight = Math.max(minHeight, labelHeightFor(nameOf(target.businessObject), right - left));
    if (bottom - top < minHeight) {
      if (handle.includes('n')) top = bottom - minHeight;
      else bottom = top + minHeight;
    }
    target.x = left;
    target.y = top;
    target.width = right - left;
    target.height = bottom - top;
    if (target.kind === 'label') return [target];

    // A pinned caption keeps its offset from the shape's centre.
    const anchor = state.labelOrigin;
    if (anchor && target.label) {
      target.label.x = anchor.x + target.x + target.width / 2 - (bounds.x + bounds.width / 2);
      target.label.y = anchor.y + target.y + target.height / 2 - (bounds.y + bounds.height / 2);
    }
    for (const edge of state.edges) {
      const original = state.edgeOrigins.get(edge);
      if (!original || original.length === 0) continue;
      const points = original.map((p) => ({ x: p.x, y: p.y }));
      const last = points.length - 1;
      if (edge.source === target) points[0] = cropPoint(target, original[1] ?? original[0]);
      if (edge.target === target) points[last] = cropPoint(target, original[last - 1] ?? original[last]);
      edge.waypoints = points;
    }
    return [target, ...state.edges];
  }

  private applyWaypoint(state: WaypointState, dx: number, dy: number): SceneElement[] {
    const base = state.insert
      ? [...state.original.slice(0, state.index), { ...state.origin }, ...state.original.slice(state.index)]
      : state.original;
    const from = base[state.index];
    const to = { x: this.maybeSnap(from.x + dx, 'x'), y: this.maybeSnap(from.y + dy, 'y') };
    const terminal = state.index === 0 || state.index === base.length - 1;
    const edge = state.edge;
    edge.waypoints = terminal
      ? freeMoveEnd(base, state.index === 0 ? 'source' : 'target', to)
      : moveBendpoint(base, state.index, to, { source: edge.source, target: edge.target });
    return [edge];
  }
}

function movedFrom(state: DragState, element: SceneElement): boolean {
  if (element.kind === 'edge') {
    const original = state.kind === 'waypoint' ? state.original : state.edgeOrigins.get(element);
    return !original || !samePoints(original, element.waypoints);
  }
  if (state.kind === 'move') {
    const from = element.kind === 'node' ? state.nodeOrigins.get(element) : state.labelOrigins.get(element);
    return !from || from.x !== element.x || from.y !== element.y;
  }
  if (state.kind === 'resize') {
    const b = state.bounds;
    return b.x !== element.x || b.y !== element.y || b.width !== element.width || b.height !== element.height;
  }
  return true;
}

function samePoints(a: readonly Point[], b: readonly Point[]): boolean {
  return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
}

function restoreMove(state: MoveState): SceneElement[] {
  for (const node of state.nodes) {
    const from = state.nodeOrigins.get(node);
    if (from) Object.assign(node, from);
  }
  for (const label of state.labels) {
    const from = state.labelOrigins.get(label);
    if (from) Object.assign(label, from);
  }
  for (const edge of state.edges) {
    const original = state.edgeOrigins.get(edge);
    if (original) edge.waypoints = original.map((p) => ({ x: p.x, y: p.y }));
  }
  return [...state.nodes, ...state.edges, ...state.loose];
}

function restoreResize(state: ResizeState): SceneElement[] {
  const { bounds, target } = state;
  Object.assign(target, bounds);
  if (target.kind === 'label') return [target];
  if (state.labelOrigin && target.label) Object.assign(target.label, state.labelOrigin);
  for (const edge of state.edges) {
    const original = state.edgeOrigins.get(edge);
    if (original) edge.waypoints = original.map((p) => ({ x: p.x, y: p.y }));
  }
  return [target, ...state.edges];
}

function restoreWaypoint(state: WaypointState): SceneElement[] {
  state.edge.waypoints = state.original.map((p) => ({ x: p.x, y: p.y }));
  return [state.edge];
}
