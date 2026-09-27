/** Waypoint editing geometry: moving a bendpoint or an endpoint of an existing route. */

import type { Point } from '@canvas/study/scene.ts';
import { containsPoint, cropPoint, cropWaypoints, type CroppableShape } from '@core/document/outline.ts';
import { simplify } from '@canvas/study/orthogonal.ts';

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

/** Two paths with exactly the same points. */
export function samePoints(a: readonly Point[], b: readonly Point[]): boolean {
  return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
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
function dropRedundant(points: readonly Point[]): Point[] {
  const out = clonePath(points);
  for (let i = out.length - 2; i >= 1; i -= 1) {
    if (distanceToSegment(out[i - 1], out[i + 1], out[i]) <= COLLINEAR_TOLERANCE) out.splice(i, 1);
  }
  return out;
}

/** A run within `ALIGN_TOLERANCE` of level, and longer across than up. */
function isLevel(a: Point, b: Point): boolean {
  return Math.abs(a.y - b.y) <= ALIGN_TOLERANCE && Math.abs(a.x - b.x) > Math.abs(a.y - b.y);
}

/** A run within `ALIGN_TOLERANCE` of upright, and longer up than across. */
function isUpright(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= ALIGN_TOLERANCE && Math.abs(a.y - b.y) > Math.abs(a.x - b.x);
}

/**
 * Move the existing interior joint `index` to `to`, keeping square the runs that met it square: a level run stays
 * level and an upright one upright, its other end sliding along. A dock slides along its shape while the run still
 * meets the shape there, and otherwise stays, the run going diagonal; so does a run that was diagonal already.
 */
export function moveBendpointSquare(waypoints: readonly Point[], index: number, to: Point, shapes: EndShapes = {}): Point[] {
  const points = clonePath(waypoints);
  const last = points.length - 1;
  if (index <= 0 || index >= last) return points;
  const from = waypoints[index];
  points[index] = { x: to.x, y: to.y };
  for (const j of [index - 1, index + 1]) {
    const other = waypoints[j];
    const level = isLevel(from, other);
    if (!level && !isUpright(from, other)) continue;
    const shape = j === 0 ? shapes.source : j === last ? shapes.target : undefined;
    if (j !== 0 && j !== last) points[j] = level ? { x: other.x, y: to.y } : { x: to.x, y: other.y };
    else if (shape) {
      // From inside the shape, level with the joint (or under it), out toward the joint: where the run meets it now.
      const inside = level ? { x: shape.x + shape.width / 2, y: to.y } : { x: to.x, y: shape.y + shape.height / 2 };
      if (containsPoint(shape, inside)) points[j] = cropPoint(shape, to, inside);
    }
  }
  return roundPath(dropRedundant(simplify(points)));
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
