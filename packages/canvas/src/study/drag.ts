/**
 * Move, resize and waypoint drags. A gesture snapshots the original geometry,
 * re-derives every frame from that snapshot plus the total pointer delta, and
 * commits through the study's `settle` on release. Cancel restores the snapshot. A move
 * dropped on a container re-homes the moved shapes there, in the same commit.
 */

import { isContainerNode, obstaclesIn, type HitOptions } from '@canvas/study/hit.ts';
import type { Bounds, Point, Scene, SceneEdge, SceneElement, SceneLabel, SceneNode } from '@canvas/study/scene.ts';
import { drawnNameOf } from '@canvas/study/elements.ts';
import { attachedTo, planeOf, visibleEndpointOf, withDescendants } from '@canvas/study/tree.ts';
import { labelHeightFor, labelMinSize } from '@canvas/study/text.ts';
import { cropPoint } from '@core/document/outline.ts';
import { freeMoveEnd, moveBendpoint, moveBendpointSquare, moveTerminal, samePoints } from '@canvas/study/edit.ts';
import { isRouted, orthogonalize, rerouteEdge } from '@canvas/study/orthogonal.ts';
import { containerFor, type Rules, type Size } from '@canvas/study/rules.ts';

export const DEFAULT_GRID_SIZE = 10;

export type DragKind = 'move' | 'resize' | 'waypoint';

/** The corner a resize drags. */
export type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw';

/** Where a move would drop: the element under the pointer, the container that would take the shapes, and whether it may. */
export interface MoveDrop {
  over?: SceneElement;
  parent?: SceneNode;
  allowed: boolean;
  /** The moved shapes whose container the drop changes. */
  rehomed: SceneNode[];
}
export type Movable = SceneNode | SceneLabel;

/** Which axes a frame may still grid-snap (an axis alignment already claimed is left alone). */
export interface GridAxes {
  x: boolean;
  y: boolean;
}

const BOTH_AXES: GridAxes = { x: true, y: true };

export interface DragOptions {
  /** Commit what the drag moved in place, and the change of container its drop makes: the study's `settle`. */
  settle: (changed: readonly SceneElement[], rehome?: { nodes: readonly SceneNode[]; into?: SceneNode }) => unknown;
  /** Draws a frame; the commit on release draws itself. */
  redraw: (elements: SceneElement[]) => void;
  snapToGrid?: boolean;
  /** A resize's minimum size, and whether a container takes a drop. */
  rules: Rules;
  getScene: () => Scene;
  /** The container the view is drilled into, which takes a move dropped on empty background. */
  getScope: () => SceneNode | undefined;
  hitTest: (point: Point, options?: HitOptions) => SceneElement | undefined;
  /** Boxes a live re-route steers around, asked once per move. */
  obstacles: (moving: readonly SceneNode[]) => Bounds[];
}

type EdgeFollow = 'all' | 'first' | 'last';

interface MoveState {
  kind: 'move';
  origin: Point;
  snap: boolean;
  reroute: boolean;
  obstacles: Bounds[];
  /** Where the shape (else caption) that snaps to the grid started; the rest keep their offsets from it. */
  lead: Point;
  /** The moving nodes, each with where it started. */
  nodes: Map<SceneNode, Point>;
  /** Pinned captions travelling with their nodes, and captions dragged on their own, each with where it started. */
  labels: Map<SceneLabel, Point>;
  /** Captions dragged on their own: pinned on drop. */
  loose: SceneLabel[];
  /** The edges at the moving nodes, each with its route at the start. */
  edges: Map<SceneEdge, Point[]>;
  /** The edges whose routes are still the router's, drawn afresh as their ends move. */
  routed: ReadonlySet<SceneEdge>;
}

interface ResizeState {
  kind: 'resize';
  origin: Point;
  target: Movable;
  handle: ResizeHandle;
  bounds: Bounds;
  min: Size;
  labelOrigin?: Point;
  edges: Map<SceneEdge, Point[]>;
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
  private readonly settle: DragOptions['settle'];
  private readonly redraw: (elements: SceneElement[]) => void;
  private readonly rules: Rules;
  private readonly getScene: () => Scene;
  private readonly getScope: () => SceneNode | undefined;
  private readonly hitTest: DragOptions['hitTest'];
  private readonly obstaclesFor: (moving: readonly SceneNode[]) => Bounds[];
  private snap: boolean;
  private state?: DragState;
  private axes: GridAxes = BOTH_AXES;

  constructor(options: DragOptions) {
    this.settle = options.settle;
    this.redraw = options.redraw;
    this.rules = options.rules;
    this.getScene = options.getScene;
    this.getScope = options.getScope;
    this.hitTest = options.hitTest;
    this.snap = options.snapToGrid ?? true;
    this.obstaclesFor = options.obstacles;
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

  /** Begin moving nodes (contents come along) and captions from `origin`. */
  startMove(elements: readonly Movable[], origin: Point, options?: { snapToGrid?: boolean; rerouteEdges?: boolean }): boolean {
    this.state = undefined;
    const scene = this.getScene();
    const moving = withDescendants(elements.filter((el): el is SceneNode => el.kind === 'node'));
    // A boundary event sits on its activity: wherever the activity goes, it goes.
    const nodes = [...moving, ...attachedTo(scene, moving)];
    const nodeSet = new Set(nodes);
    const loose = elements.filter((el): el is SceneLabel => el.kind === 'label' && !(el.owner.kind === 'node' && nodeSet.has(el.owner)));
    if (nodes.length === 0 && loose.length === 0) return false;

    const lead = nodes[0] ?? loose[0];
    const labels = new Map<SceneLabel, Point>(loose.map((label) => [label, { x: label.x, y: label.y }]));
    const edges = new Map<SceneEdge, Point[]>();
    for (const node of nodes) {
      if (node.label?.pinned) labels.set(node.label, { x: node.label.x, y: node.label.y });
      for (const edge of [...node.outgoing, ...node.incoming]) {
        edges.set(edge, edge.waypoints.map((p) => ({ x: p.x, y: p.y })));
        if (edge.label?.pinned && followOf(edge, nodeSet) === 'all') labels.set(edge.label, { x: edge.label.x, y: edge.label.y });
      }
    }
    // The routes still as the router drew them: a move draws those afresh, where a route bent by hand stays bent.
    const routed = new Set([...edges.keys()].filter((edge) => followOf(edge, nodeSet) !== 'all' && isRouted(edge, obstaclesIn(scene, planeOf(edge)))));

    this.state = {
      kind: 'move',
      origin: { ...origin },
      snap: options?.snapToGrid ?? this.snap,
      reroute: options?.rerouteEdges ?? true,
      obstacles: this.obstaclesFor(nodes),
      lead: { x: lead.x, y: lead.y },
      nodes: new Map(nodes.map((node) => [node, { x: node.x, y: node.y }])),
      labels,
      loose,
      edges,
      routed,
    };
    return true;
  }

  startResize(target: Movable, handle: ResizeHandle, origin: Point): boolean {
    this.state = undefined;
    const edges = new Map<SceneEdge, Point[]>();
    if (target.kind === 'node') {
      for (const edge of [...target.outgoing, ...target.incoming]) edges.set(edge, edge.waypoints.map((p) => ({ x: p.x, y: p.y })));
    }
    const min = target.kind === 'label'
      ? labelMinSize(drawnNameOf(this.getScene().model, target.element))
      : this.rules.minSizeFor(target);
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
    const changed = this.finish(point, grid);
    if (changed) this.settle(changed);
    return changed ?? [];
  }

  /** Apply once more at `point` and close the drag: what actually moved, uncommitted; nothing when no drag was on. */
  private finish(point: Point, grid: GridAxes): SceneElement[] | undefined {
    const state = this.state;
    if (!state) return undefined;
    const touched = this.update(point, grid);
    this.state = undefined;
    if (state.kind === 'move') for (const label of state.loose) label.pinned = true;
    if (state.kind === 'resize' && state.target.kind === 'label') state.target.pinned = true;
    return touched.filter((element) => movedFrom(state, element));
  }

  /** Where the move in progress would drop at `point`; `undefined` for any other drag. */
  dropAt(point: Point): MoveDrop | undefined {
    const state = this.state;
    const scene = this.getScene();
    if (state?.kind !== 'move' || state.nodes.size === 0) return undefined;
    const nodes = [...state.nodes.keys()];
    const moving = new Set(nodes.map((node) => node.id));
    const over = this.hitTest(point, { accept: (el) => !moving.has(el.kind === 'label' ? el.owner.id : el.id) });
    const hit = !over || over.kind === 'label' ? undefined : over.kind === 'node' && isContainerNode(over) ? over : over.parent;
    const container = containerFor(hit) as SceneNode | undefined;
    const parent = container?.kind === 'node' ? container : undefined;
    const roots = nodes.filter((node) => !(node.parent && moving.has(node.parent.id)));
    const scope = this.getScope();
    const allowed = this.rules.canMove(roots, parent ?? scope ?? scene.rootElement);
    const home = parent ?? scope;
    const rehomed = roots.filter((node) => node !== home && (node.parent ?? undefined) !== home);
    return { ...(over ? { over } : {}), ...(parent ? { parent } : {}), allowed, rehomed };
  }

  /**
   * End a move dropped at `point`. A container that refuses the shapes cancels it; else the move and the
   * change of container it makes are one commit. `false` when it was cancelled.
   */
  drop(point: Point, grid: GridAxes = BOTH_AXES): boolean {
    const target = this.dropAt(point);
    if (target && !target.allowed) {
      this.cancel();
      return false;
    }
    const changed = this.finish(point, grid);
    if (changed) {
      const rehome = target && target.rehomed.length > 0 ? { nodes: target.rehomed, into: target.parent ?? this.getScope() } : undefined;
      this.settle(changed, rehome);
    }
    return true;
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
    return this.snap && this.axes[axis] ? snapTo(value, DEFAULT_GRID_SIZE) : value;
  }

  private applyMove(state: MoveState, rawDx: number, rawDy: number): SceneElement[] {
    let dx = rawDx;
    let dy = rawDy;
    if (state.snap) {
      const { lead } = state;
      if (this.axes.x) dx = snapTo(lead.x + rawDx, DEFAULT_GRID_SIZE) - lead.x;
      if (this.axes.y) dy = snapTo(lead.y + rawDy, DEFAULT_GRID_SIZE) - lead.y;
    }
    for (const [node, from] of state.nodes) {
      node.x = from.x + dx;
      node.y = from.y + dy;
    }
    for (const [label, from] of state.labels) {
      label.x = from.x + dx;
      label.y = from.y + dy;
    }
    for (const [edge, original] of state.edges) {
      if (original.length === 0) continue;
      const mode = followOf(edge, state.nodes);
      if (mode === 'all') {
        edge.waypoints = original.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        continue;
      }
      const points = original.map((p) => ({ x: p.x, y: p.y }));
      const end: 'source' | 'target' = mode === 'first' ? 'source' : 'target';
      const index = mode === 'first' ? 0 : points.length - 1;
      const shape = mode === 'first' ? edge.source : edge.target;
      const docked = shape && visibleEndpointOf(shape, planeOf(edge));
      // A route the author bent is re-docked, never re-cut.
      if (state.reroute && points.length > 2 && docked && !state.routed.has(edge)) {
        moveTerminal(points, end, cropPoint(docked, points[index === 0 ? 1 : index - 1]));
        edge.waypoints = orthogonalize(points);
        continue;
      }
      points[index] = { x: original[index].x + dx, y: original[index].y + dy };
      edge.waypoints = points;
      if (state.reroute) rerouteEdge(edge, { obstacles: state.obstacles });
    }
    return [...state.nodes.keys(), ...state.edges.keys(), ...state.loose];
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
    if (target.kind === 'label') minHeight = Math.max(minHeight, labelHeightFor(drawnNameOf(this.getScene().model, target.element), right - left));
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
    for (const [edge, original] of state.edges) {
      if (original.length === 0) continue;
      const points = original.map((p) => ({ x: p.x, y: p.y }));
      const last = points.length - 1;
      if (edge.source === target) points[0] = cropPoint(target, original[1] ?? original[0]);
      if (edge.target === target) points[last] = cropPoint(target, original[last - 1] ?? original[last]);
      edge.waypoints = points;
    }
    return [target, ...state.edges.keys()];
  }

  private applyWaypoint(state: WaypointState, dx: number, dy: number): SceneElement[] {
    const base = state.insert
      ? [...state.original.slice(0, state.index), { ...state.origin }, ...state.original.slice(state.index)]
      : state.original;
    const from = base[state.index];
    const to = { x: this.maybeSnap(from.x + dx, 'x'), y: this.maybeSnap(from.y + dy, 'y') };
    const terminal = state.index === 0 || state.index === base.length - 1;
    const edge = state.edge;
    // A joint just drawn out of a run bends it; one already there keeps the runs meeting it square.
    const shapes = { source: edge.source, target: edge.target };
    edge.waypoints = terminal
      ? freeMoveEnd(base, state.index === 0 ? 'source' : 'target', to)
      : state.insert ? moveBendpoint(base, state.index, to, shapes) : moveBendpointSquare(base, state.index, to, shapes);
    return [edge];
  }
}

/** Which ends of `edge` a move of `moving` carries: both, its source's, or else its target's. */
function followOf(edge: SceneEdge, moving: { has(node: SceneNode): boolean }): EdgeFollow {
  const source = !!edge.source && moving.has(edge.source);
  const target = !!edge.target && moving.has(edge.target);
  return source && target ? 'all' : source ? 'first' : 'last';
}

function movedFrom(state: DragState, element: SceneElement): boolean {
  if (element.kind === 'edge') {
    const original = state.kind === 'waypoint' ? state.original : state.edges.get(element)!;
    return !samePoints(original, element.waypoints);
  }
  if (state.kind === 'move') {
    const from = element.kind === 'node' ? state.nodes.get(element)! : state.labels.get(element)!;
    return from.x !== element.x || from.y !== element.y;
  }
  if (state.kind === 'resize') {
    const b = state.bounds;
    return b.x !== element.x || b.y !== element.y || b.width !== element.width || b.height !== element.height;
  }
  return true;
}

function restoreMove(state: MoveState): SceneElement[] {
  for (const [node, from] of state.nodes) Object.assign(node, from);
  for (const [label, from] of state.labels) Object.assign(label, from);
  for (const [edge, original] of state.edges) edge.waypoints = original.map((p) => ({ x: p.x, y: p.y }));
  return [...state.nodes.keys(), ...state.edges.keys(), ...state.loose];
}

function restoreResize(state: ResizeState): SceneElement[] {
  const { bounds, target } = state;
  Object.assign(target, bounds);
  if (target.kind === 'label') return [target];
  if (state.labelOrigin && target.label) Object.assign(target.label, state.labelOrigin);
  for (const [edge, original] of state.edges) edge.waypoints = original.map((p) => ({ x: p.x, y: p.y }));
  return [target, ...state.edges.keys()];
}

function restoreWaypoint(state: WaypointState): SceneElement[] {
  state.edge.waypoints = state.original.map((p) => ({ x: p.x, y: p.y }));
  return [state.edge];
}
