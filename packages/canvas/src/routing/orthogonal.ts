/**
 * Orthogonal routing: a clean 2–5 point path between two shapes, cropped to their
 * outlines. It avoids only the two endpoint shapes by construction; other shapes
 * are dodged when an `obstacles` list is given and a candidate misses them.
 */

import { BPMN } from '@core/constants.ts';

import type { Bounds, Point, SceneEdge, SceneNode } from '@canvas/model/scene.ts';
import { visibleEndpointOf } from '@canvas/model/tree.ts';
import { centerOf, cropPoint, cropWaypoints, distance, type CroppableShape } from '@canvas/routing/crop.ts';

export type RoutableShape = CroppableShape;

export const DEFAULT_CLEARANCE = 20;
export const DEFAULT_STRAIGHT_TOLERANCE = 10;

export interface RouteOptions {
  clearance?: number;
  straightTolerance?: number;
  crop?: boolean;
  /** Boxes to steer around; advisory — a pair with no clean candidate keeps its route. */
  obstacles?: readonly Bounds[];
  /** The drill-down scope, for resolving which shape an edge end docks on. */
  scope?: SceneNode;
}

const EPSILON = 1e-6;

export function route(source: RoutableShape, target: RoutableShape, options: RouteOptions = {}): Point[] {
  const raw = routeCenters(source, target, options);
  return options.crop === false ? raw : cropWaypoints(raw, source, target);
}

/** Centre to centre, cropped: the plain diagonal a `bpmn:Association` is drawn as. */
export function straightRoute(source: RoutableShape, target: RoutableShape, options: RouteOptions = {}): Point[] {
  const cs = centerOf(source);
  const ct = centerOf(target);
  if (options.crop === false) return [cs, ct];
  return [cropPoint(source, ct), cropPoint(target, cs)];
}

export function isStraightRouted(type: string | undefined): boolean {
  return type === BPMN.Association;
}

/** Waypoints for a connection of `type`. Every path that mints or re-routes goes through here. */
export function routeFor(type: string | undefined, source: RoutableShape, target: RoutableShape, options: RouteOptions = {}): Point[] {
  return isStraightRouted(type) ? straightRoute(source, target, options) : route(source, target, options);
}

/** The shape standing in for an edge end; a connection routes from the middle of its path. */
export function routableEnd(element: SceneNode | SceneEdge): RoutableShape {
  if (element.kind === 'node') return element;
  const mid = pathMidpoint(element.waypoints);
  return { x: mid.x, y: mid.y, width: 0, height: 0, type: element.type };
}

/** The point half way along a polyline by length. */
export function pathMidpoint(waypoints: readonly Point[]): Point {
  if (waypoints.length === 0) return { x: 0, y: 0 };
  if (waypoints.length === 1) return { ...waypoints[0] };
  let total = 0;
  for (let i = 1; i < waypoints.length; i += 1) total += distance(waypoints[i - 1], waypoints[i]);
  let travelled = 0;
  for (let i = 1; i < waypoints.length; i += 1) {
    const a = waypoints[i - 1];
    const b = waypoints[i];
    const length = distance(a, b);
    if (travelled + length >= total / 2) {
      const t = length < EPSILON ? 0 : (total / 2 - travelled) / length;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    travelled += length;
  }
  return { ...waypoints[waypoints.length - 1] };
}

/** The centre-anchored path, before cropping. */
export function routeCenters(source: RoutableShape, target: RoutableShape, options: RouteOptions = {}): Point[] {
  const clearance = options.clearance ?? DEFAULT_CLEARANCE;
  const tolerance = options.straightTolerance ?? DEFAULT_STRAIGHT_TOLERANCE;
  const s = shapeBounds(source);
  const t = shapeBounds(target);
  const cs = centerOf(s);
  const ct = centerOf(t);

  if (source === target || (Math.abs(cs.x - ct.x) < EPSILON && Math.abs(cs.y - ct.y) < EPSILON)) {
    return selfLoop(s, cs, clearance);
  }

  const gapX = Math.max(t.x - (s.x + s.width), s.x - (t.x + t.width));
  const gapY = Math.max(t.y - (s.y + s.height), s.y - (t.y + t.height));
  const dx = ct.x - cs.x;
  const dy = ct.y - cs.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const blockers = (options.obstacles ?? []).filter((box) => !boxesOverlap(box, s) && !boxesOverlap(box, t));
  const around = (preferred: Point[], alternates: Point[][] = []): Point[] =>
    steerAround(preferred, alternates, blockers, s, t, cs, ct, horizontal, clearance);

  // Diagonal: one elbow, leaving along the dominant axis.
  if (gapX > 0 && gapY > 0) {
    const alongX = simplify([cs, { x: ct.x, y: cs.y }, ct]);
    const alongY = simplify([cs, { x: cs.x, y: ct.y }, ct]);
    return horizontal ? around(alongX, [alongY]) : around(alongY, [alongX]);
  }
  if (gapX > 0) {
    const midX = dx > 0 ? (s.x + s.width + t.x) / 2 : (t.x + t.width + s.x) / 2;
    const jog = simplify([cs, { x: midX, y: cs.y }, { x: midX, y: ct.y }, ct]);
    if (Math.abs(dy) <= tolerance) {
      const y = (cs.y + ct.y) / 2;
      return around([{ x: cs.x, y }, { x: ct.x, y }], [jog]);
    }
    return around(jog);
  }
  if (gapY > 0) {
    const midY = dy > 0 ? (s.y + s.height + t.y) / 2 : (t.y + t.height + s.y) / 2;
    const jog = simplify([cs, { x: cs.x, y: midY }, { x: ct.x, y: midY }, ct]);
    if (Math.abs(dx) <= tolerance) {
      const x = (cs.x + ct.x) / 2;
      return around([{ x, y: cs.y }, { x, y: ct.y }], [jog]);
    }
    return around(jog);
  }
  return simplify(detour(s, t, cs, ct, horizontal, clearance, blockers));
}

/**
 * Fresh waypoints for an existing edge, each end docked on the shape actually on
 * screen for it. `undefined` when the edge is dangling or both ends collapse into
 * the same container.
 */
export function routeEdge(edge: SceneEdge, options?: RouteOptions): Point[] | undefined {
  if (!edge.source || !edge.target) return undefined;
  const source = visibleEndpointOf(edge.source, options?.scope);
  const target = visibleEndpointOf(edge.target, options?.scope);
  if (source === target && edge.source !== edge.target) return undefined;
  return routeFor(edge.type, source, target, options);
}

/** Re-route `edge` in the scene; whether the geometry changed. */
export function rerouteEdge(edge: SceneEdge, options?: RouteOptions): boolean {
  const points = routeEdge(edge, options);
  if (!points || samePath(points, edge.waypoints)) return false;
  edge.waypoints = points;
  return true;
}

export function rerouteEdges(edges: Iterable<SceneEdge>, options?: RouteOptions): SceneEdge[] {
  const changed: SceneEdge[] = [];
  for (const edge of edges) if (rerouteEdge(edge, options)) changed.push(edge);
  return changed;
}

export const ORTHOGONAL_TOLERANCE = 3;

/**
 * Square `points` up: near-aligned runs are flattened by moving an interior joint,
 * and (with `elbows`) a genuinely diagonal run gets an elbow. Redundant points go.
 */
export function orthogonalize(points: readonly Point[], tolerance = ORTHOGONAL_TOLERANCE, elbows = true): Point[] {
  const out = points.map((p) => ({ x: p.x, y: p.y }));
  if (out.length < 2) return out;
  for (let i = 0; i < out.length - 1; i += 1) {
    const a = out[i];
    const b = out[i + 1];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const off = Math.min(dx, dy);
    if (off < EPSILON || off > tolerance) continue;
    const horizontal = dy <= dx;
    if (i + 1 < out.length - 1) out[i + 1] = horizontal ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    else if (i > 0) out[i] = horizontal ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
  }
  if (!elbows) return simplify(out);
  const squared: Point[] = [out[0]];
  for (let i = 0; i < out.length - 1; i += 1) {
    const a = squared[squared.length - 1];
    const b = out[i + 1];
    if (Math.min(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) <= tolerance) {
      squared.push(b);
      continue;
    }
    squared.push(elbow(a, b, squared[squared.length - 2], out[i + 2]));
    squared.push(b);
  }
  return simplify(squared);
}

function elbow(a: Point, b: Point, before?: Point, after?: Point): Point {
  const verticalFirst = { x: a.x, y: b.y };
  const horizontalFirst = { x: b.x, y: a.y };
  if (before) return Math.abs(before.y - a.y) < EPSILON ? verticalFirst : horizontalFirst;
  if (after) return Math.abs(after.y - b.y) < EPSILON ? horizontalFirst : verticalFirst;
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? horizontalFirst : verticalFirst;
}

export function isOrthogonal(points: readonly Point[], tolerance = 1e-6): boolean {
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (Math.abs(a.x - b.x) > tolerance && Math.abs(a.y - b.y) > tolerance) return false;
  }
  return true;
}

function selfLoop(s: Bounds, cs: Point, clearance: number): Point[] {
  const outX = s.x + s.width + clearance;
  const topY = s.y - clearance;
  const backX = s.x + (s.width * 3) / 4;
  return [{ x: cs.x, y: cs.y }, { x: outX, y: cs.y }, { x: outX, y: topY }, { x: backX, y: topY }, { x: backX, y: cs.y }];
}

type Lane = 'below' | 'above' | 'right' | 'left';

function laneOrder(horizontal: boolean): Lane[] {
  return horizontal ? ['below', 'above', 'right', 'left'] : ['right', 'left', 'below', 'above'];
}

/** The first candidate that misses every blocker, else a U past what is in the way. */
function steerAround(
  preferred: Point[],
  alternates: Point[][],
  blockers: readonly Bounds[],
  s: Bounds, t: Bounds, cs: Point, ct: Point,
  horizontal: boolean,
  clearance: number,
): Point[] {
  if (blockers.length === 0) return preferred;
  const inTheWay = blockers.filter((box) => pathCrosses(preferred, box));
  if (inTheWay.length === 0) return preferred;
  for (const alternate of alternates) {
    if (!blockers.some((box) => pathCrosses(alternate, box))) return alternate;
  }
  const span = unionOf([s, t, ...inTheWay]);
  for (const lane of laneOrder(horizontal)) {
    const path = lanePath(lane, span, cs, ct, clearance);
    if (crossesBox(path[0], path[1], t) || crossesBox(path[2], path[3], s)) continue;
    if (blockers.some((box) => pathCrosses(path, box))) continue;
    return simplify(path);
  }
  return preferred;
}

function pathCrosses(points: readonly Point[], box: Bounds): boolean {
  for (let i = 0; i < points.length - 1; i += 1) if (crossesBox(points[i], points[i + 1], box)) return true;
  return false;
}

function boxesOverlap(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function unionOf(boxes: readonly Bounds[]): Bounds {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** Two boxes overlapping on both axes: leave both toward a lane beyond their extent. */
function detour(
  s: Bounds, t: Bounds, cs: Point, ct: Point,
  horizontal: boolean,
  clearance: number,
  blockers: readonly Bounds[] = [],
): Point[] {
  const span = unionOf([s, t]);
  let fallback: Point[] | undefined;
  let fallbackLength = Infinity;
  for (const lane of laneOrder(horizontal)) {
    const path = lanePath(lane, span, cs, ct, clearance);
    const clean = !crossesBox(path[0], path[1], t) && !crossesBox(path[2], path[3], s)
      && !blockers.some((box) => pathCrosses(path, box));
    if (clean) return path;
    const length = pathLength(path);
    if (length < fallbackLength) {
      fallbackLength = length;
      fallback = path;
    }
  }
  return fallback ?? [cs, ct];
}

function lanePath(lane: Lane, span: Bounds, cs: Point, ct: Point, clearance: number): Point[] {
  switch (lane) {
    case 'below': {
      const y = span.y + span.height + clearance;
      return [cs, { x: cs.x, y }, { x: ct.x, y }, ct];
    }
    case 'above': {
      const y = span.y - clearance;
      return [cs, { x: cs.x, y }, { x: ct.x, y }, ct];
    }
    case 'right': {
      const x = span.x + span.width + clearance;
      return [cs, { x, y: cs.y }, { x, y: ct.y }, ct];
    }
    case 'left': {
      const x = span.x - clearance;
      return [cs, { x, y: cs.y }, { x, y: ct.y }, ct];
    }
  }
}

function shapeBounds(shape: RoutableShape): Bounds {
  return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
}

function crossesBox(a: Point, b: Point, box: Bounds): boolean {
  const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
  const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
  return lo.x < box.x + box.width && hi.x > box.x && lo.y < box.y + box.height && hi.y > box.y;
}

function pathLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
  }
  return total;
}

/** Drop duplicate and axis-collinear interior points. */
export function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < EPSILON && Math.abs(last.y - p.y) < EPSILON) continue;
    out.push({ x: p.x, y: p.y });
  }
  for (let i = out.length - 2; i >= 1; i -= 1) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const collinear = (Math.abs(a.x - b.x) < EPSILON && Math.abs(b.x - c.x) < EPSILON)
      || (Math.abs(a.y - b.y) < EPSILON && Math.abs(b.y - c.y) < EPSILON);
    if (collinear) out.splice(i, 1);
  }
  return out.length >= 2 ? out : points.map((p) => ({ x: p.x, y: p.y }));
}

function samePath(a: readonly Point[], b: readonly Point[]): boolean {
  return a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < EPSILON && Math.abs(p.y - b[i].y) < EPSILON);
}
