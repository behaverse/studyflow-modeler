/**
 * Orthogonal (Manhattan) routing — the waypoints a *new* or re-connected edge gets
 * (design §3 `routing/orthogonal.ts`, §2 "All routed orthogonally with endpoint
 * cropping to the shape outline", §6 P4).
 *
 * Deliberately NOT a general obstacle-avoiding router: it lays out a clean 2–5
 * point path between the two endpoint shapes and only guarantees that the path
 * does not run through *those two*. A third shape sitting in the way is the user's
 * to fix by dragging a waypoint (`interaction/drag.ts`), exactly as in bpmn-js.
 *
 * The layout is a small ordered decision list on how the two boxes are separated
 * (`gapX`/`gapY` are the gaps between their projections on each axis):
 *
 * | case | shape | points |
 * |---|---|---|
 * | same shape (or two concentric ones) | loop out of the right side and back into the top | 5 |
 * | `gapX > 0 && gapY > 0` (diagonal) | **L** — leave along the dominant axis, enter the other | 3 |
 * | `gapX > 0`, centres within `straightTolerance` | **straight** horizontal | 2 |
 * | `gapX > 0` | **Z** — jog through the middle of the horizontal gap | 4 |
 * | `gapY > 0` | the same two, vertically | 2 / 4 |
 * | boxes overlap on both axes | **U** — detour through a lane `clearance` beyond both | 4 |
 *
 * Every path is built anchored at the two shape CENTRES and is then cropped to the
 * silhouettes by `routing/crop.ts`, which slides each endpoint along its own
 * segment — so the result is axis-aligned end to end (see {@link isOrthogonal}).
 *
 * Pure geometry: shapes are {@link RoutableShape} (bounds + optional `$type`), which
 * a `SceneNode` satisfies structurally. Nothing here touches the DOM, the moddle
 * tree or the scene; the scene-level helpers ({@link rerouteEdge}) mutate only
 * `edge.waypoints`, leaving the DI write to `model/writeback.ts`.
 */

import { BPMN } from '@core/constants.ts';

import type { Bounds, Point, SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import {
  centerOf,
  cropPoint,
  cropWaypoints,
  distance,
  type CroppableShape,
} from '@canvas/routing/crop.ts';

/** A shape the router can connect: DI bounds plus the business-object `$type`. */
export type RoutableShape = CroppableShape;

/** Distance a detour (or self-loop) keeps from the shapes it routes around. */
export const DEFAULT_CLEARANCE = 20;

/**
 * How far apart two centres may sit on the cross axis and still be joined by a
 * single straight segment instead of a Z-jog (diagram units).
 */
export const DEFAULT_STRAIGHT_TOLERANCE = 10;

/** Tuning for {@link route}. */
export interface RouteOptions {
  /** Detour/self-loop clearance. Default {@link DEFAULT_CLEARANCE}. */
  clearance?: number;
  /** Straight-segment snap window. Default {@link DEFAULT_STRAIGHT_TOLERANCE}. */
  straightTolerance?: number;
  /** Crop the endpoints to the shape outlines. Default `true`. */
  crop?: boolean;
  /**
   * Boxes the route should steer around — the other shapes on the plane. ADVISORY:
   * the router still picks its path from the same short list of shapes it always
   * has ({@link routeCenters}), and only prefers the ones that miss these boxes; a
   * pair with no clean candidate keeps the route it would have had. Absent (the
   * default) nothing is dodged, which is the behaviour every non-move caller wants.
   *
   * Boxes overlapping either endpoint are dropped: a route MUST reach its own ends,
   * so a shape sitting on one of them cannot be avoided and would only veto every
   * candidate. That is what lets one scene-wide list serve every edge.
   */
  obstacles?: readonly Bounds[];
}

const EPSILON = 1e-6;

// --- public API -------------------------------------------------------------

/**
 * Orthogonal waypoints from `source` to `target`, cropped to both outlines unless
 * `options.crop === false`. Always at least two points, all segments axis-aligned.
 */
export function route(source: RoutableShape, target: RoutableShape, options: RouteOptions = {}): Point[] {
  const raw = routeCenters(source, target, options);
  return options.crop === false ? raw : cropWaypoints(raw, source, target);
}

/**
 * The two points of a STRAIGHT connection: centre to centre, cropped to both
 * outlines — i.e. a plain diagonal, with no elbows at all.
 *
 * Not every BPMN flow is orthogonal. bpmn-js's `BpmnLayouter` runs the manhattan
 * layout for sequence and message flows but leaves a plain `bpmn:Association` as the
 * line between the two mids, which is why a text annotation hangs off its subject on
 * a slanted dotted leader (`edge-videos/preview/frame_08`) instead of an L-bend.
 * {@link routeFor} picks between the two by flow type.
 */
export function straightRoute(
  source: RoutableShape,
  target: RoutableShape,
  options: RouteOptions = {},
): Point[] {
  const cs = centerOf(shapeBounds(source));
  const ct = centerOf(shapeBounds(target));
  if (options.crop === false) return [cs, ct];
  return [cropPoint(source, ct), cropPoint(target, cs)];
}

/**
 * Waypoints for a connection of `type` — {@link straightRoute} for the flow types
 * BPMN draws as a plain line, {@link route} for everything else.
 *
 * Every path that mints or re-routes a connection goes through here so that what a
 * hover ghost draws, what a connect drag previews and what the drop commits are the
 * same geometry (parity spec addendum 5 §3).
 */
export function routeFor(
  type: string | undefined,
  source: RoutableShape,
  target: RoutableShape,
  options: RouteOptions = {},
): Point[] {
  return isStraightRouted(type) ? straightRoute(source, target, options) : route(source, target, options);
}

/**
 * The {@link RoutableShape} that stands in for a connection END.
 *
 * A shape routes as its own box. A **connection** — which is an end for exactly
 * one connection kind, the `bpmn:Association` reaching a text annotation that
 * hangs off a sequence flow (ux-spec §4) — routes as a zero-size box at the middle
 * of its path, so the association leaves the flow's midpoint and is cropped to
 * nothing at that end. That is where bpmn-js hangs the same leader, and it is the
 * one point on an edge that stays put as the two shapes it joins move.
 */
export function routableEnd(element: SceneNode | SceneEdge): RoutableShape {
  if (element.kind === 'node') return element;
  const mid = pathMidpoint(element.waypoints);
  return { x: mid.x, y: mid.y, width: 0, height: 0, type: element.type };
}

/**
 * The point half way along a polyline BY LENGTH (not the middle waypoint, which on
 * an L-bend sits at the corner). An empty path answers the origin.
 */
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

/**
 * Whether a flow of `type` is drawn as a straight line rather than an orthogonal
 * route. Only the plain `bpmn:Association` is: a DATA association still routes
 * orthogonally, which is how every shipped example's DI already has them.
 */
export function isStraightRouted(type: string | undefined): boolean {
  return type === BPMN.Association;
}

/**
 * The centre-anchored path, before cropping — the router's own output. Exposed for
 * tests and for callers that want to crop against something other than the two
 * endpoint shapes (a boundary event's host, say).
 */
export function routeCenters(
  source: RoutableShape,
  target: RoutableShape,
  options: RouteOptions = {},
): Point[] {
  const clearance = options.clearance ?? DEFAULT_CLEARANCE;
  const tolerance = options.straightTolerance ?? DEFAULT_STRAIGHT_TOLERANCE;
  const s = shapeBounds(source);
  const t = shapeBounds(target);
  const cs = centerOf(s);
  const ct = centerOf(t);

  // A self-connection — and the degenerate case of two shapes sharing a centre,
  // which no lane can separate — becomes a loop.
  if (source === target || (Math.abs(cs.x - ct.x) < EPSILON && Math.abs(cs.y - ct.y) < EPSILON)) {
    return selfLoop(s, cs, clearance);
  }

  const gapX = Math.max(t.x - (s.x + s.width), s.x - (t.x + t.width));
  const gapY = Math.max(t.y - (s.y + s.height), s.y - (t.y + t.height));
  const dx = ct.x - cs.x;
  const dy = ct.y - cs.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  // A shape sitting on either endpoint is not dodgeable — see `RouteOptions.obstacles`.
  const blockers = (options.obstacles ?? []).filter(
    (box) => !boxesOverlap(box, s) && !boxesOverlap(box, t),
  );
  const around = (preferred: Point[], alternates: Point[][] = []): Point[] =>
    steerAround(preferred, alternates, blockers, s, t, cs, ct, horizontal, clearance);

  // Diagonal — a single elbow, leaving along the dominant axis. Neither leg can
  // cross the other shape: the boxes are separated on BOTH axes. The elbow bent the
  // OTHER way joins the same two points, so it is the first thing to try when a
  // third shape is in the way.
  if (gapX > 0 && gapY > 0) {
    const alongX = simplify([cs, { x: ct.x, y: cs.y }, ct]);
    const alongY = simplify([cs, { x: cs.x, y: ct.y }, ct]);
    return horizontal ? around(alongX, [alongY]) : around(alongY, [alongX]);
  }

  // Separated horizontally, overlapping vertically.
  if (gapX > 0) {
    const midX = dx > 0
      ? (s.x + s.width + t.x) / 2
      : (t.x + t.width + s.x) / 2;
    const jog = simplify([cs, { x: midX, y: cs.y }, { x: midX, y: ct.y }, ct]);
    if (Math.abs(dy) <= tolerance) {
      const y = (cs.y + ct.y) / 2;
      return around([{ x: cs.x, y }, { x: ct.x, y }], [jog]);
    }
    return around(jog);
  }

  // Separated vertically, overlapping horizontally.
  if (gapY > 0) {
    const midY = dy > 0
      ? (s.y + s.height + t.y) / 2
      : (t.y + t.height + s.y) / 2;
    const jog = simplify([cs, { x: cs.x, y: midY }, { x: ct.x, y: midY }, ct]);
    if (Math.abs(dx) <= tolerance) {
      const x = (cs.x + ct.x) / 2;
      return around([{ x, y: cs.y }, { x, y: ct.y }], [jog]);
    }
    return around(jog);
  }

  // The boxes overlap on both axes — go around through an outside lane.
  return simplify(detour(s, t, cs, ct, horizontal, clearance, blockers));
}

/**
 * Fresh waypoints for an existing `edge` from its current endpoint geometry — the
 * "re-route after an endpoint moved (or was re-connected)" helper. Returns
 * `undefined` when the edge is dangling (no `source`/`target`), which the caller
 * should read as "keep what you have".
 */
export function routeEdge(edge: SceneEdge, options?: RouteOptions): Point[] | undefined {
  if (!edge.source || !edge.target) return undefined;
  return routeFor(edge.type, edge.source, edge.target, options);
}

/**
 * Re-route `edge` in the SCENE (`edge.waypoints`) and report whether the geometry
 * actually changed. The backing `di:waypoint` list is deliberately NOT written
 * here — the caller commits through `model/writeback.ts` so one gesture is one
 * revision bump (see `Canvas.rerouteEdges`).
 */
export function rerouteEdge(edge: SceneEdge, options?: RouteOptions): boolean {
  const points = routeEdge(edge, options);
  if (!points || samePath(points, edge.waypoints)) return false;
  edge.waypoints = points;
  return true;
}

/** Re-route every edge of `edges`; returns the ones whose waypoints changed. */
export function rerouteEdges(edges: Iterable<SceneEdge>, options?: RouteOptions): SceneEdge[] {
  const changed: SceneEdge[] = [];
  for (const edge of edges) {
    if (rerouteEdge(edge, options)) changed.push(edge);
  }
  return changed;
}

/**
 * The edges a set of elements affects: the elements' own edges plus every edge
 * docked to any of the nodes (and, for a container, to its descendants), each
 * listed once. This is what "re-route the selection" means.
 */
export function edgesAffectedBy(elements: Iterable<SceneElement>): SceneEdge[] {
  const out: SceneEdge[] = [];
  const seen = new Set<SceneEdge>();
  const push = (edge: SceneEdge): void => {
    if (seen.has(edge)) return;
    seen.add(edge);
    out.push(edge);
  };
  const visited = new Set<SceneNode>();
  const visit = (node: SceneNode): void => {
    if (visited.has(node)) return;
    visited.add(node);
    for (const edge of node.incoming) push(edge);
    for (const edge of node.outgoing) push(edge);
    for (const child of node.children) if (child.kind === 'node') visit(child);
  };
  for (const element of elements) {
    if (element.kind === 'edge') push(element);
    else visit(element);
  }
  return out;
}

/**
 * How far off-axis a segment may be before {@link orthogonalize} stops nudging it
 * straight and grows an elbow instead (diagram units).
 */
export const ORTHOGONAL_TOLERANCE = 3;

/**
 * Square `points` up: every segment comes back axis-aligned, and the points the
 * squaring made redundant are gone.
 *
 * This is the "orthogonal preservation" of parity spec §4, factored out of the
 * gestures that need it (`interaction/segments.ts`): a run that is a unit or two
 * off-axis — as imported geometry routinely is — is nudged flat by moving the end
 * that is free to move (an interior joint before an endpoint, which is docked to a
 * shape and belongs to the cropper); a genuinely DIAGONAL run gets an elbow, bent
 * so it leaves perpendicular to the run before it and arrives perpendicular to the
 * run after it.
 *
 * A two-point diagonal is deliberately left alone when it is only off by a hair:
 * both of its points are docks, so there is nothing here that may move, and an
 * imported `136,118 → 200,120` flow is not something an unrelated edit should
 * silently re-cut.
 *
 * With `elbows` false, pass 2 is skipped: near-aligned runs are still flattened
 * and redundant joints still dropped, but a genuinely diagonal run is left as the
 * author bent it (`interaction/segments.ts` `moveBendpoint`) rather than being
 * re-cut into an L.
 */
export function orthogonalize(
  points: readonly Point[],
  tolerance = ORTHOGONAL_TOLERANCE,
  elbows = true,
): Point[] {
  const out = points.map((p) => ({ x: p.x, y: p.y }));
  if (out.length < 2) return out;

  // Pass 1 — flatten near-aligned runs by pulling an interior end onto the other.
  for (let i = 0; i < out.length - 1; i += 1) {
    const a = out[i];
    const b = out[i + 1];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const off = Math.min(dx, dy);
    if (off < EPSILON || off > tolerance) continue;
    const horizontal = dy <= dx;
    if (i + 1 < out.length - 1) {
      out[i + 1] = horizontal ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    } else if (i > 0) {
      out[i] = horizontal ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
    }
  }

  if (!elbows) return simplify(out);

  // Pass 2 — grow an elbow wherever a run is still diagonal.
  const squared: Point[] = [out[0]];
  for (let i = 0; i < out.length - 1; i += 1) {
    const a = squared[squared.length - 1];
    const b = out[i + 1];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    // Within the tolerance there is nothing to bend: either pass 1 already flattened
    // the run, or both of its ends are docks and neither may move.
    if (Math.min(dx, dy) <= tolerance) {
      squared.push(b);
      continue;
    }
    squared.push(elbow(a, b, squared[squared.length - 2], out[i + 2]));
    squared.push(b);
  }

  return simplify(squared);
}

/**
 * The corner a diagonal `a`–`b` is bent through: leave `a` perpendicular to the run
 * that arrived there, arrive at `b` perpendicular to the run that leaves it, and
 * failing both, travel along the dominant axis first.
 */
function elbow(a: Point, b: Point, before?: Point, after?: Point): Point {
  const verticalFirst = { x: a.x, y: b.y };
  const horizontalFirst = { x: b.x, y: a.y };
  if (before) {
    return Math.abs(before.y - a.y) < EPSILON ? verticalFirst : horizontalFirst;
  }
  if (after) {
    return Math.abs(after.y - b.y) < EPSILON ? horizontalFirst : verticalFirst;
  }
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? horizontalFirst : verticalFirst;
}

/** Whether every segment of `points` is axis-aligned (the router's contract). */
export function isOrthogonal(points: readonly Point[], tolerance = 1e-6): boolean {
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (Math.abs(a.x - b.x) > tolerance && Math.abs(a.y - b.y) > tolerance) return false;
  }
  return true;
}

// --- path construction ------------------------------------------------------

/**
 * A self-connection: out of the right flank, up over the top-right corner and back
 * down into the top edge. Anchored at the centre / an interior column so cropping
 * trims both ends to the outline.
 */
function selfLoop(s: Bounds, cs: Point, clearance: number): Point[] {
  const outX = s.x + s.width + clearance;
  const topY = s.y - clearance;
  const backX = s.x + (s.width * 3) / 4;
  return [
    { x: cs.x, y: cs.y },
    { x: outX, y: cs.y },
    { x: outX, y: topY },
    { x: backX, y: topY },
    { x: backX, y: cs.y },
  ];
}

/** The four lanes a U-detour can use, in the order they are preferred. */
type Lane = 'below' | 'above' | 'right' | 'left';

/** The lanes tried first, given which way the pair is mainly separated. */
function laneOrder(horizontal: boolean): Lane[] {
  return horizontal ? ['below', 'above', 'right', 'left'] : ['right', 'left', 'below', 'above'];
}

/**
 * The first of `preferred`, then `alternates`, that misses every box in `blockers` —
 * and if none of them does, a U through a lane placed clear of whatever is actually
 * in the way. `preferred` comes back unchanged when there is nothing to dodge or
 * nothing that dodges it, so a diagram with no obstacle list routes exactly as it
 * always did.
 *
 * ponytail: candidate SELECTION, not a search. It re-uses the handful of path shapes
 * the router already draws instead of growing an A* over a visibility graph — which
 * is the whole reason this file could stay geometry. Two shapes with no clean lane
 * between them keep the crossing route, and dragging a waypoint is still the fix.
 */
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

  // Both endpoints plus everything the direct route ran into: a lane beyond THAT is
  // clear of the obstruction without being flung to the far side of the diagram by
  // some unrelated shape.
  const span = unionOf([s, t, ...inTheWay]);
  for (const lane of laneOrder(horizontal)) {
    const path = lanePath(lane, span, cs, ct, clearance);
    // The stubs still have to clear the two endpoint shapes, as in `detour`.
    if (crossesBox(path[0], path[1], t) || crossesBox(path[2], path[3], s)) continue;
    if (blockers.some((box) => pathCrosses(path, box))) continue;
    return simplify(path);
  }
  return preferred;
}

/** Whether any segment of `points` passes through `box`. */
function pathCrosses(points: readonly Point[], box: Bounds): boolean {
  for (let i = 0; i < points.length - 1; i += 1) {
    if (crossesBox(points[i], points[i + 1], box)) return true;
  }
  return false;
}

/** Whether two boxes share any area (touching edges do not count). */
function boxesOverlap(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** The smallest box containing all of `boxes`. */
function unionOf(boxes: readonly Bounds[]): Bounds {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Route around two boxes that overlap on both axes: leave both shapes towards a
 * lane placed `clearance` beyond their common extent and traverse there. Lanes are
 * tried in a fixed preferred order (a horizontal pair loops underneath — the
 * familiar BPMN "go back" shape — a vertical pair passes on the right) and the
 * first one whose stubs clear the opposite shape wins; if none does, the shortest
 * candidate is used.
 */
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

/** The four-point path through one lane, placed `clearance` beyond `span`. */
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

// --- geometry helpers -------------------------------------------------------

/** The plain box of a routable shape (`view/viewport.ts`'s `sceneBounds` is the scene-wide one). */
function shapeBounds(shape: RoutableShape): Bounds {
  return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
}

/** Whether the axis-aligned segment `a`–`b` passes through `box`. */
function crossesBox(a: Point, b: Point, box: Bounds): boolean {
  const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
  const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
  return lo.x < box.x + box.width && hi.x > box.x
    && lo.y < box.y + box.height && hi.y > box.y;
}

function pathLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
  }
  return total;
}

/** Drop duplicate and (axis-aligned) collinear intermediate points, returning fresh objects. */
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

/** Whether two waypoint lists are the same geometry. */
function samePath(a: readonly Point[], b: readonly Point[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => Math.abs(p.x - b[i].x) < EPSILON && Math.abs(p.y - b[i].y) < EPSILON);
}
