/** Waypoint editing geometry: moving a bendpoint or an endpoint of an existing route. */

import type { Point } from '@canvas/model/scene.ts';
import { cropPoint, cropWaypoints, type CroppableShape } from '@canvas/routing/crop.ts';
import { simplify } from '@canvas/routing/orthogonal.ts';

export interface EndShapes {
  source?: CroppableShape;
  target?: CroppableShape;
}

const ALIGN_TOLERANCE = 3;
/** A joint within this distance of the line through its neighbours is dropped. */
const COLLINEAR_TOLERANCE = 5;
const EPSILON = 1e-6;

function clonePath(points: readonly Point[]): Point[] {
  return points.map((p) => ({ x: p.x, y: p.y }));
}

function roundPath(points: readonly Point[]): Point[] {
  return points.map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
}

export function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < EPSILON) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Drop interior joints that no longer bend anything. Endpoints are never dropped. */
export function dropRedundant(points: readonly Point[]): Point[] {
  const out = clonePath(points);
  for (let i = out.length - 2; i >= 1; i -= 1) {
    if (distanceToSegment(out[i - 1], out[i + 1], out[i]) <= COLLINEAR_TOLERANCE) out.splice(i, 1);
  }
  return out;
}

/**
 * Move an interior bendpoint to `to`; the runs meeting it may go diagonal. With
 * `shapes` the two ends are re-cropped and joints made redundant are dropped.
 */
export function moveBendpoint(waypoints: readonly Point[], index: number, to: Point, shapes: EndShapes = {}): Point[] {
  const points = clonePath(waypoints);
  if (index <= 0 || index >= points.length - 1) return points;
  points[index] = { x: to.x, y: to.y };
  const cropped = shapes.source || shapes.target ? cropWaypoints(points, shapes.source, shapes.target) : points;
  return roundPath(dropRedundant(simplify(cropped)));
}

/**
 * Move the terminal waypoint of `end` to `to`, taking the neighbouring joint along
 * when the run between them is axis-aligned (a square run stays square).
 */
export function moveTerminal(points: Point[], end: 'source' | 'target', to: Point): void {
  if (points.length < 2) return;
  const last = points.length - 1;
  const i = end === 'source' ? 0 : last;
  const j = end === 'source' ? 1 : last - 1;
  const dock = points[i];
  const neighbour = points[j];
  points[i] = { x: to.x, y: to.y };
  if (points.length <= 2 || j <= 0 || j >= last) return;
  const dx = Math.abs(neighbour.x - dock.x);
  const dy = Math.abs(neighbour.y - dock.y);
  if (dy <= ALIGN_TOLERANCE && dx > dy) points[j] = { x: neighbour.x, y: to.y };
  else if (dx <= ALIGN_TOLERANCE && dy > dx) points[j] = { x: to.x, y: neighbour.y };
}

/** An endpoint dropped in open space: the tip lands where the pointer let go. */
export function freeMoveEnd(waypoints: readonly Point[], end: 'source' | 'target', to: Point): Point[] {
  const points = clonePath(waypoints);
  if (points.length < 2) return points;
  moveTerminal(points, end, to);
  return roundPath(dropRedundant(simplify(points)));
}

/**
 * Re-dock `end` onto `shape` where it was dropped: walk from the drop point toward
 * the neighbouring joint and dock where that walk leaves the outline. The other
 * end is re-cropped against the run that now reaches it.
 */
export function redockEnd(
  waypoints: readonly Point[],
  end: 'source' | 'target',
  shape: CroppableShape,
  at: Point,
  shapes: EndShapes = {},
): Point[] {
  const points = clonePath(waypoints);
  if (points.length < 2) return points;
  const last = points.length - 1;
  const j = end === 'source' ? 1 : last - 1;
  moveTerminal(points, end, cropPoint(shape, points[j], at));
  const other = end === 'source' ? shapes.target : shapes.source;
  if (other) {
    const k = end === 'source' ? last : 0;
    const n = end === 'source' ? last - 1 : 1;
    points[k] = cropPoint(other, points[n]);
  }
  return roundPath(dropRedundant(simplify(points)));
}
