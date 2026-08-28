/**
 * Connection SEGMENT geometry — the half of edge editing that moves a whole
 * straight run rather than a single point (parity spec §2 "segment-move handles",
 * §3 "add-bendpoint-by-dragging a segment", §4 "orthogonal preservation +
 * cropping"). This is the port of diagram-js's `ConnectionSegmentMove`.
 *
 * A bendpoint drag asks "where does this POINT go?"; a segment drag asks "where
 * does this LINE go?" — and the second question is the one that keeps a Manhattan
 * route Manhattan, because sliding a segment perpendicular to itself only ever
 * lengthens or shortens the two neighbouring runs. The interesting cases are at the
 * ends:
 *
 * - an INTERIOR segment simply takes its two joints with it;
 * - a TERMINAL segment cannot take its endpoint with it — that end is docked to a
 *   shape — so it either **slides the dock along the shape's side** (while the
 *   segment still crosses the shape) or **grows a new joint** (when it no longer
 *   does), which is precisely how dragging a straight flow downwards turns it into
 *   the source-bottom → across → target-bottom detour of `edge-videos/v1/frame_03`;
 * - dragging that detour flat again collapses it back to the straight two-point
 *   edge of `frame_09`, because the re-dock puts both joints back inside their
 *   shapes and the redundant points are dropped.
 *
 * Everything here is PURE geometry over {@link Point} lists plus the structural
 * {@link CroppableShape} (`routing/crop.ts`) — no DOM, no scene, no DI — so it is
 * unit-testable under jsdom and reusable by the drag runner, the reconnect gesture
 * and the tests alike. The scene/DI half stays where it belongs:
 * `interaction/drag.ts` runs the gesture, `model/writeback.ts` commits it.
 */

import type { Point } from '@canvas/model/scene.ts';
import {
  centerOf,
  containsPoint,
  cropPoint,
  cropWaypoints,
  type CroppableShape,
} from '@canvas/routing/crop.ts';
import { ORTHOGONAL_TOLERANCE, orthogonalize, simplify } from '@canvas/routing/orthogonal.ts';

/** Which way a straight segment runs. */
export type SegmentAxis = 'h' | 'v';

/** One straight run of a connection, indexed by its FIRST waypoint. */
export interface Segment {
  /** Index of the segment's first waypoint (`waypoints[index] → waypoints[index+1]`). */
  index: number;
  a: Point;
  b: Point;
  /** The dominant direction: `'h'` for a horizontal run, `'v'` for a vertical one. */
  axis: SegmentAxis;
  /** Midpoint — where the move grip is drawn and grabbed. */
  mid: Point;
  /** Extent along {@link Segment.axis}. */
  length: number;
  /** Whether the run is axis-aligned within {@link SEGMENT_ALIGN_TOLERANCE}. */
  aligned: boolean;
}

/** The two shapes a connection is docked to, for the re-dock step. */
export interface SegmentShapes {
  source?: CroppableShape;
  target?: CroppableShape;
}

/** How far off-axis a run may be and still count as straight (diagram units). */
export const SEGMENT_ALIGN_TOLERANCE = 3;

/**
 * Shortest run that gets a move grip. A grip is 20 units long; offering one on a
 * shorter stub would put a handle over the bendpoints at both of its ends.
 */
export const MIN_GRIP_SEGMENT_LENGTH = 20;

/**
 * Grip hit box: 20 along the run, 18 across it (diagram-js's segment dragger).
 * "Across" is wide enough to cover the drawn glyph, whose two tips reach 8 units
 * either side of the run (`interaction/selection.ts` `GRIP_TRIANGLE_REACH`) — a
 * press on a tip must grab the grip it landed on.
 */
export const SEGMENT_GRIP_LENGTH = 20;
export const SEGMENT_GRIP_WIDTH = 18;

/** How close a press must be to a segment's BODY to grab it (parity spec §3). */
export const SEGMENT_BODY_TOLERANCE = 5;

/** How far a re-docked endpoint is kept from the corners of the side it lands on. */
const DOCK_INSET = 6;

/**
 * How near the middle of a side a drop has to land to dock exactly there —
 * diagram-js's `SNAP_TOLERANCE`, the window `BendpointSnapping` offers the target's
 * mid in.
 */
const DOCK_SNAP_TOLERANCE = 7;

const EPSILON = 1e-6;

// --- reading a path ---------------------------------------------------------

/**
 * The straight runs of `waypoints`, zero-length ones skipped (a duplicate point is
 * not a segment anybody can grab).
 */
export function segmentsOf(waypoints: readonly Point[]): Segment[] {
  const out: Segment[] = [];
  for (let index = 0; index < waypoints.length - 1; index += 1) {
    const a = waypoints[index];
    const b = waypoints[index + 1];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx < EPSILON && dy < EPSILON) continue;
    const axis: SegmentAxis = dy <= dx ? 'h' : 'v';
    out.push({
      index,
      a: { x: a.x, y: a.y },
      b: { x: b.x, y: b.y },
      axis,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      length: axis === 'h' ? dx : dy,
      aligned: (axis === 'h' ? dy : dx) <= SEGMENT_ALIGN_TOLERANCE,
    });
  }
  return out;
}

/** Whether a segment is long and straight enough to carry a move grip. */
export function isGrippable(segment: Segment): boolean {
  return segment.aligned && segment.length >= MIN_GRIP_SEGMENT_LENGTH;
}

/**
 * The segment a press at `point` grabs, or `undefined`. Two ways in, both of which
 * diagram-js routes through `ConnectionSegmentMove`:
 *
 * - the move GRIP — which follows the pointer along its run ({@link insideGrip}),
 *   so anywhere on a grippable run within the grip's reach counts (parity spec §2);
 * - the run's BODY — anywhere within `tolerance` of the line, which is how a bend
 *   is *added* to an edge that has none (parity spec §3).
 */
export function segmentAt(
  waypoints: readonly Point[],
  point: Point,
  options: { tolerance?: number; gripsOnly?: boolean } = {},
): Segment | undefined {
  const segments = segmentsOf(waypoints);
  for (const segment of segments) {
    if (isGrippable(segment) && insideGrip(segment, point)) return segment;
  }
  if (options.gripsOnly) return undefined;
  const tolerance = options.tolerance ?? SEGMENT_BODY_TOLERANCE;
  for (const segment of segments) {
    if (segment.aligned && distanceToSegment(segment.a, segment.b, point) <= tolerance) {
      return segment;
    }
  }
  return undefined;
}

/**
 * Whether `point` falls inside a segment's grip reach. The grip travels with the
 * pointer along its run ({@link gripPositionAt}), so its reach is the run's extent
 * along the axis and the grip's own {@link SEGMENT_GRIP_WIDTH} across it — wherever
 * on the run the pointer is, the grip is drawn under it. The extent is inset half a
 * grip length off each end: that close to a joint (or a dock, where a press means
 * the SHAPE) the run's own handle is not the grip, and no grip is drawn there.
 */
export function insideGrip(segment: Segment, point: Point): boolean {
  const across = SEGMENT_GRIP_WIDTH / 2;
  const inset = SEGMENT_GRIP_LENGTH / 2;
  if (segment.axis === 'h') {
    return point.x >= Math.min(segment.a.x, segment.b.x) + inset
      && point.x <= Math.max(segment.a.x, segment.b.x) - inset
      && Math.abs(point.y - segment.mid.y) <= across;
  }
  return point.y >= Math.min(segment.a.y, segment.b.y) + inset
    && point.y <= Math.max(segment.a.y, segment.b.y) - inset
    && Math.abs(point.x - segment.mid.x) <= across;
}

/**
 * Where the grip glyph sits while the pointer hovers `point`: the pointer's
 * projection onto the run, clamped half a grip length off each end so the glyph
 * never sits on top of the bendpoints (diagram-js moves its segment dragger with
 * the cursor the same way).
 */
export function gripPositionAt(segment: Segment, point: Point): Point {
  const half = SEGMENT_GRIP_LENGTH / 2;
  if (segment.axis === 'h') {
    const lo = Math.min(segment.a.x, segment.b.x) + half;
    const hi = Math.max(segment.a.x, segment.b.x) - half;
    return roundPoint({ x: Math.min(Math.max(point.x, lo), hi), y: segment.mid.y });
  }
  const lo = Math.min(segment.a.y, segment.b.y) + half;
  const hi = Math.max(segment.a.y, segment.b.y) - half;
  return roundPoint({ x: segment.mid.x, y: Math.min(Math.max(point.y, lo), hi) });
}

// --- moving a segment -------------------------------------------------------

/**
 * `waypoints` with segment `index` slid perpendicular to itself by `delta` — the
 * component of `delta` along the run is ignored, because a segment cannot move
 * along its own line.
 *
 * With `shapes` given the two ends are re-docked to their outlines afterwards, so
 * the result is what the reference produces: endpoints on the silhouette, every run
 * axis-aligned, redundant joints gone (a run dragged flat collapses the detour it
 * came from). Without them the geometry is left raw — which is what a caller that
 * has no shapes (a dangling edge, a unit test on bare points) wants.
 */
export function moveSegment(
  waypoints: readonly Point[],
  index: number,
  delta: Point,
  shapes: SegmentShapes = {},
): Point[] {
  const original = clonePath(waypoints);
  if (index < 0 || index + 1 >= original.length) return original;

  const a = original[index];
  const b = original[index + 1];
  const axis: SegmentAxis = Math.abs(b.y - a.y) <= Math.abs(b.x - a.x) ? 'h' : 'v';
  const offset = axis === 'h' ? delta.y : delta.x;
  // The run is flattened onto ONE coordinate as it moves: a segment that was a
  // couple of units off-axis (an imported edge often is) becomes exactly straight
  // the moment it is dragged, which is what keeps the result Manhattan.
  const at = (axis === 'h' ? (a.y + b.y) / 2 : (a.x + b.x) / 2) + offset;

  let points = clonePath(original);
  points[index] = axis === 'h' ? { x: a.x, y: at } : { x: at, y: a.y };
  points[index + 1] = axis === 'h' ? { x: b.x, y: at } : { x: at, y: b.y };

  // Ends first from the back, so the unshift below cannot invalidate `index`.
  if (index + 1 === original.length - 1) {
    points = dockTerminal(points, original, 'target', axis, at, shapes.target);
  }
  if (index === 0) {
    points = dockTerminal(points, original, 'source', axis, at, shapes.source);
  }

  return settle(points, shapes);
}

/**
 * `waypoints` with the INTERIOR bendpoint `index` moved to `to` — and nothing else
 * rewired. This is diagram-js's `BendpointMove`: the joint goes exactly where the
 * pointer is, its neighbours stay put, and the two runs meeting it become diagonal
 * when that is what the drag asked for. The route is deliberately NOT re-squared —
 * a bendpoint is the one gesture that may bend an orthogonal edge out of Manhattan.
 *
 * With `shapes` given the two ends are re-cropped to their outlines (a joint next
 * to an endpoint changes the terminal run's direction, and the dock slides along
 * the silhouette to meet it), and joints the move made redundant — dragged onto a
 * neighbour, or exactly back into line — are dropped. A terminal index is returned
 * untouched: dragging an ENDPOINT is the reconnect/free-move gesture, not this one.
 */
export function moveBendpoint(
  waypoints: readonly Point[],
  index: number,
  to: Point,
  shapes: SegmentShapes = {},
): Point[] {
  const points = clonePath(waypoints);
  if (index <= 0 || index >= points.length - 1) return points;
  points[index] = { x: to.x, y: to.y };
  const cropped = shapes.source || shapes.target
    ? cropWaypoints(points, shapes.source, shapes.target)
    : points;
  return roundPath(simplify(cropped));
}

/**
 * Re-dock the `end` endpoint of a path whose terminal segment has just moved.
 *
 * `at` is the run's new constant coordinate and `axis` its direction. Two outcomes,
 * and which one applies is decided by a single question — does the run still cross
 * the shape?
 *
 * - **yes** — the dock SLIDES along the side it is on (the endpoint keeps its
 *   segment, the segment keeps its shape);
 * - **no** — the endpoint stays on the shape and grows a JOINT: a stub, on the
 *   shape's mid-line, from the outline out to the run. This is the moment a
 *   straight flow becomes a detour.
 *
 * With no shape the endpoint is simply left where it was and the joint inserted
 * unconditionally, which keeps the pure-geometry contract of this module honest.
 */
function dockTerminal(
  points: readonly Point[],
  original: readonly Point[],
  end: 'source' | 'target',
  axis: SegmentAxis,
  at: number,
  shape?: CroppableShape,
): Point[] {
  const out = clonePath(points);
  const last = out.length - 1;
  const i = end === 'source' ? 0 : last;
  const towards = out[end === 'source' ? 1 : last - 1];

  if (!shape) {
    const before = original[i];
    const moved = out[i];
    if (Math.abs(before.x - moved.x) < EPSILON && Math.abs(before.y - moved.y) < EPSILON) {
      return out;
    }
    // Keep the old dock and reach the moved run through a fresh joint.
    if (end === 'source') out.unshift({ x: before.x, y: before.y });
    else out.push({ x: before.x, y: before.y });
    return out;
  }

  const mid = centerOf(shape);
  // Where the moved run crosses the shape's mid-line: inside means the endpoint can
  // simply slide along the side it already sits on.
  const onRun = axis === 'h' ? { x: mid.x, y: at } : { x: at, y: mid.y };
  if (containsPoint(shape, onRun)) {
    out[i] = cropPoint(shape, towards, onRun);
    return out;
  }

  // Outside: grow the stub on the shape's mid-line, and dock where it leaves the
  // outline. The run therefore starts/ends at the shape's middle, which is where
  // the reference puts it (`edge-videos/v1/frame_03`, `v2/frame_10`).
  const joint = axis === 'h' ? { x: mid.x, y: at } : { x: at, y: mid.y };
  const dock = cropPoint(shape, joint, mid);
  if (end === 'source') {
    out[0] = joint;
    out.unshift(dock);
  } else {
    out[last] = joint;
    out.push(dock);
  }
  return out;
}

/**
 * Re-dock a connection's `end` where it was actually DROPPED (parity spec §1/§4:
 * "re-docks to the nearest sensible SIDE, cropped").
 *
 * The side is not a free choice: an orthogonal route may only meet a shape square
 * on, so the run that arrives at the endpoint decides WHICH side it lands on
 * (horizontal → a flank, vertical → the top or bottom). What the drop decides is
 * the position ALONG that side — clamped off the corners, and snapped to the middle
 * of the side within {@link DOCK_SNAP_TOLERANCE} the way diagram-js's
 * `BendpointSnapping` does ({@link dockAlong}) — which is the whole point of the
 * gesture: the edge ends where the user let go rather than at the centre the router
 * would have anchored it to, while a drop AIMED at the centre still lands there
 * exactly.
 *
 * Keeping the route square then costs one of two things: an interior neighbour is
 * simply pulled onto the new line, and a two-point route (nothing interior to move,
 * and an opposite end that is docked and may NOT be moved) grows a Z-jog through the
 * middle — the same shape `routing/orthogonal.ts` produces for two shapes that are
 * offset on both axes.
 */
export function redockEnd(
  waypoints: readonly Point[],
  end: 'source' | 'target',
  shape: CroppableShape,
  at: Point,
  shapes: SegmentShapes = {},
): Point[] {
  const points = clonePath(waypoints);
  if (points.length < 2) return points;
  const last = points.length - 1;
  const i = end === 'source' ? 0 : last;
  const j = end === 'source' ? 1 : last - 1;
  const dock = points[i];
  const neighbour = points[j];
  const horizontal = Math.abs(neighbour.y - dock.y) <= Math.abs(neighbour.x - dock.x);

  const moved: Point = horizontal
    ? { x: dock.x, y: dockAlong(at.y, shape.y, shape.y + shape.height) }
    : { x: dockAlong(at.x, shape.x, shape.x + shape.width), y: dock.y };
  points[i] = moved;

  if (points.length > 2) {
    points[j] = horizontal
      ? { x: neighbour.x, y: moved.y }
      : { x: moved.x, y: neighbour.y };
  } else {
    const other = points[end === 'source' ? 1 : 0];
    const middle = horizontal ? (other.x + moved.x) / 2 : (other.y + moved.y) / 2;
    const beside = horizontal ? { x: middle, y: other.y } : { x: other.x, y: middle };
    const across = horizontal ? { x: middle, y: moved.y } : { x: moved.x, y: middle };
    if (end === 'source') points.splice(1, 0, across, beside);
    else points.splice(1, 0, beside, across);
  }

  return settle(points, shapes);
}

/**
 * `waypoints` with the `end` endpoint dropped at `to` and NOTHING rewired — the
 * third outcome of parity spec §1, the one a drop clear of every shape gets: the
 * connection keeps the element it always pointed at and its tip simply ends up
 * where the pointer let go.
 *
 * The tip going where the pointer is does not mean the PATH may go anywhere. §4 is
 * unconditional ("all resulting segments are axis-aligned"), and a free move is an
 * edit like any other, so the route reaches the drop the way every other edit here
 * reaches anything: it leaves its anchor on the axis the terminal run already had
 * and turns once, through an elbow, into the drop. Dragging the tip straight along
 * that axis collapses the elbow away again and the edge is simply longer or
 * shorter.
 *
 * No cropping: the endpoint has deliberately LEFT its shape's outline, which is the
 * whole point of the gesture, so `settle`'s re-crop — which would pull the tip back
 * onto the silhouette — is exactly what must not happen here.
 */
export function freeMoveEnd(
  waypoints: readonly Point[],
  end: 'source' | 'target',
  to: Point,
): Point[] {
  const points = clonePath(waypoints);
  if (points.length < 2) return points;
  const last = points.length - 1;
  const i = end === 'source' ? 0 : last;
  const j = end === 'source' ? 1 : last - 1;
  const anchor = points[j];
  const dock = points[i];
  // The axis the terminal run already had. Taken from the run itself rather than
  // from the drop, so the edge keeps leaving its anchor the way it left it — a flow
  // that ran out of a shape's flank goes on doing so, and the turn happens out at
  // the far end where the pointer is.
  const horizontal = Math.abs(dock.y - anchor.y) <= Math.abs(dock.x - anchor.x);
  const elbow = horizontal ? { x: to.x, y: anchor.y } : { x: anchor.x, y: to.y };
  points[i] = { x: to.x, y: to.y };
  points.splice(end === 'source' ? 1 : last, 0, elbow);
  // `orthogonalize` flattens anything the insertion left crooked (an imported run
  // that was a unit or two off-axis) and drops the elbow again when the drag was
  // along the run and it became redundant. Elbow-growing is off: a genuinely
  // diagonal run elsewhere on the path (a hand-bent joint) is the author's and
  // must survive this edit untouched.
  return roundPath(orthogonalize(points, ORTHOGONAL_TOLERANCE, false));
}

/**
 * The common tail of every edit here: flatten the runs the edit left near-aligned,
 * drop the joints it made redundant, and re-crop both ends to their shapes —
 * twice, because a collapse (the detour dragged flat) hands the endpoints a NEW
 * neighbour to be cropped against, which is what lets a reshaped edge become
 * straight again. Elbow-growing is off throughout: a genuinely diagonal run (a
 * hand-bent joint, see {@link moveBendpoint}) is the author's, and sliding one
 * segment must not re-cut the rest of the path.
 */
function settle(waypoints: readonly Point[], shapes: SegmentShapes): Point[] {
  let points = orthogonalize(waypoints, ORTHOGONAL_TOLERANCE, false);
  if (!shapes.source && !shapes.target) return roundPath(points);
  const before = points.length;
  points = orthogonalize(cropWaypoints(points, shapes.source, shapes.target), ORTHOGONAL_TOLERANCE, false);
  if (points.length !== before) {
    points = orthogonalize(cropWaypoints(points, shapes.source, shapes.target), ORTHOGONAL_TOLERANCE, false);
  }
  return roundPath(points);
}

/**
 * Waypoints are written to the DI, and the DI is a document: a drag whose pointer
 * position made the round trip through screen coordinates must not leave
 * `179.99999999999994` in the file where the user saw 180. A thousandth of a
 * diagram unit is far below anything that renders.
 */
function roundPath(points: readonly Point[]): Point[] {
  return points.map(roundPoint);
}

function roundPoint(p: Point): Point {
  return { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 };
}

// --- geometry ---------------------------------------------------------------

function clonePath(points: readonly Point[]): Point[] {
  return points.map((p) => ({ x: p.x, y: p.y }));
}

function clamp(value: number, min: number, max: number): number {
  const lo = Math.min(min + DOCK_INSET, max);
  const hi = Math.max(max - DOCK_INSET, min);
  return Math.min(Math.max(value, Math.min(lo, hi)), Math.max(lo, hi));
}

/**
 * Where along a side a dropped endpoint docks: the drop position, held off the
 * corners — but SNAPPED to the middle of the side when it lands near it.
 *
 * The snap is diagram-js's (`BendpointSnapping` offers the target's mid on a
 * bendpoint/reconnect drag, `SNAP_TOLERANCE` wide). Without it there is no way to
 * ask for the centred dock every routed edge has, because hitting a 1-unit
 * coordinate with a pointer is not a thing a person can do: every reconnect would
 * leave the flow meeting the shape a few units off-centre, which is the one
 * difference from an edge the router laid out.
 */
function dockAlong(value: number, min: number, max: number): number {
  const middle = (min + max) / 2;
  if (Math.abs(value - middle) <= DOCK_SNAP_TOLERANCE) return middle;
  return clamp(value, min, max);
}

/** Distance from `p` to the finite segment `a`–`b`. */
export function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < EPSILON) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
