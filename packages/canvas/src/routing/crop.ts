/**
 * Endpoint cropping: pull an edge end from inside a shape out to the drawn outline
 * (circle, diamond, page, cylinder, rectangle), walking along the incident segment
 * so an axis-aligned segment stays axis-aligned.
 */

import type { Bounds, Point } from '@canvas/model/scene.ts';
import { categoryOf } from '@canvas/render/shapes.ts';
import { isDataStore } from '@canvas/rules/rules.ts';

export interface CroppableShape extends Bounds {
  readonly type?: string;
}

export type Outline = 'rect' | 'ellipse' | 'diamond' | 'dataObject' | 'dataStore';

/** Must match `render/shapes.ts`. */
const DATA_FOLD_RATIO = 0.32;
const DATA_STORE_CAP_RATIO = 0.12;
const DATA_STORE_MAX_CAP = 8;
const EPSILON = 1e-9;

export function outlineFor(type: string | undefined): Outline {
  if (!type) return 'rect';
  switch (categoryOf(type)) {
    case 'event': return 'ellipse';
    case 'gateway': return 'diamond';
    case 'data': return isDataStore(type) ? 'dataStore' : 'dataObject';
    default: return 'rect';
  }
}

export function centerOf(bounds: Bounds): Point {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function boxContains(box: Bounds, point: Point): boolean {
  return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
}

export function containsPoint(shape: CroppableShape, point: Point): boolean {
  const { x, y, width: w, height: h } = shape;
  if (w <= 0 || h <= 0) return false;
  const inBox = point.x >= x - EPSILON && point.x <= x + w + EPSILON && point.y >= y - EPSILON && point.y <= y + h + EPSILON;
  switch (outlineFor(shape.type)) {
    case 'rect':
      return inBox;
    case 'ellipse': {
      const u = (point.x - (x + w / 2)) / (w / 2);
      const v = (point.y - (y + h / 2)) / (h / 2);
      return u * u + v * v <= 1 + EPSILON;
    }
    case 'diamond': {
      const u = Math.abs(point.x - (x + w / 2)) / (w / 2);
      const v = Math.abs(point.y - (y + h / 2)) / (h / 2);
      return u + v <= 1 + EPSILON;
    }
    case 'dataObject':
      return inBox && point.x - point.y <= foldConstant(shape) + EPSILON;
    case 'dataStore': {
      if (Math.abs(point.x - (x + w / 2)) > w / 2 + EPSILON) return false;
      const ry = capHeight(shape);
      if (point.y >= y + ry - EPSILON && point.y <= y + h - ry + EPSILON) return true;
      const cy = point.y < y + ry ? y + ry : y + h - ry;
      const u = (point.x - (x + w / 2)) / (w / 2);
      const v = (point.y - cy) / ry;
      return u * u + v * v <= 1 + EPSILON;
    }
  }
}

function foldConstant(shape: Bounds): number {
  const fold = Math.min(shape.width, shape.height) * DATA_FOLD_RATIO;
  return shape.x + shape.width - fold - shape.y;
}

function capHeight(shape: Bounds): number {
  return Math.min(shape.height * DATA_STORE_CAP_RATIO, DATA_STORE_MAX_CAP);
}

/** Where the ray from `from` (inside `shape`) toward `towards` leaves the outline. */
export function outlinePoint(shape: CroppableShape, from: Point, towards: Point): Point | undefined {
  const dx = towards.x - from.x;
  const dy = towards.y - from.y;
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return undefined;
  if (shape.width <= 0 || shape.height <= 0) return undefined;
  if (!containsPoint(shape, from)) return undefined;
  const t = exitT(shape, from, dx, dy);
  if (t === undefined || !Number.isFinite(t) || t < 0) return undefined;
  return { x: from.x + dx * t, y: from.y + dy * t };
}

function exitT(shape: CroppableShape, p: Point, dx: number, dy: number): number | undefined {
  switch (outlineFor(shape.type)) {
    case 'rect': return rectExitT(shape, p, dx, dy);
    case 'ellipse':
      return ellipseExitT(shape.x + shape.width / 2, shape.y + shape.height / 2, shape.width / 2, shape.height / 2, p, dx, dy);
    case 'diamond': return diamondExitT(shape, p, dx, dy);
    case 'dataObject': return minDefined(rectExitT(shape, p, dx, dy), foldExitT(shape, p, dx, dy));
    case 'dataStore': return cylinderExitT(shape, p, dx, dy);
  }
}

function minDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

function rectExitT(box: Bounds, p: Point, dx: number, dy: number): number | undefined {
  let t = Infinity;
  if (dx > EPSILON) t = Math.min(t, (box.x + box.width - p.x) / dx);
  else if (dx < -EPSILON) t = Math.min(t, (box.x - p.x) / dx);
  if (dy > EPSILON) t = Math.min(t, (box.y + box.height - p.y) / dy);
  else if (dy < -EPSILON) t = Math.min(t, (box.y - p.y) / dy);
  return Number.isFinite(t) ? Math.max(0, t) : undefined;
}

function ellipseRoots(cx: number, cy: number, rx: number, ry: number, p: Point, dx: number, dy: number): number[] {
  if (rx <= 0 || ry <= 0) return [];
  const ux = (p.x - cx) / rx;
  const uy = (p.y - cy) / ry;
  const vx = dx / rx;
  const vy = dy / ry;
  const a = vx * vx + vy * vy;
  if (a < EPSILON) return [];
  const b = 2 * (ux * vx + uy * vy);
  const c = ux * ux + uy * uy - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const root = Math.sqrt(disc);
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
}

function ellipseExitT(cx: number, cy: number, rx: number, ry: number, p: Point, dx: number, dy: number): number | undefined {
  for (const t of ellipseRoots(cx, cy, rx, ry, p, dx, dy)) if (t >= -EPSILON) return Math.max(0, t);
  return undefined;
}

function diamondExitT(box: Bounds, p: Point, dx: number, dy: number): number | undefined {
  const rx = box.width / 2;
  const ry = box.height / 2;
  const ux = (p.x - (box.x + rx)) / rx;
  const uy = (p.y - (box.y + ry)) / ry;
  const vx = dx / rx;
  const vy = dy / ry;
  let best: number | undefined;
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      const denom = sx * vx + sy * vy;
      if (Math.abs(denom) < EPSILON) continue;
      const t = (1 - (sx * ux + sy * uy)) / denom;
      if (t < -EPSILON) continue;
      const hu = ux + t * vx;
      const hv = uy + t * vy;
      if (sx * hu < -EPSILON || sy * hv < -EPSILON) continue;
      if (best === undefined || t < best) best = Math.max(0, t);
    }
  }
  return best;
}

function foldExitT(shape: Bounds, p: Point, dx: number, dy: number): number | undefined {
  const denom = dx - dy;
  if (denom <= EPSILON) return undefined;
  const t = (foldConstant(shape) - (p.x - p.y)) / denom;
  return t >= 0 ? t : undefined;
}

function cylinderExitT(shape: Bounds, p: Point, dx: number, dy: number): number | undefined {
  const { x, y, width: w, height: h } = shape;
  const rx = w / 2;
  const ry = capHeight(shape);
  const cx = x + rx;
  let best: number | undefined;
  let tSide: number | undefined;
  if (dx > EPSILON) tSide = (x + w - p.x) / dx;
  else if (dx < -EPSILON) tSide = (x - p.x) / dx;
  if (tSide !== undefined && tSide >= 0) {
    const hitY = p.y + tSide * dy;
    if (hitY >= y + ry - EPSILON && hitY <= y + h - ry + EPSILON) best = tSide;
  }
  if (Math.abs(dy) > EPSILON) {
    const up = dy < 0;
    const capY = up ? y + ry : y + h - ry;
    for (const t of ellipseRoots(cx, capY, rx, ry, p, dx, dy)) {
      if (t < -EPSILON) continue;
      const hitY = p.y + t * dy;
      if (up ? hitY <= capY + EPSILON : hitY >= capY - EPSILON) {
        best = minDefined(best, Math.max(0, t));
        break;
      }
    }
  }
  return best;
}

/** The outline point toward `towards`, walking from `anchor` (default: the centre). */
export function cropPoint(shape: CroppableShape, towards: Point, anchor?: Point): Point {
  const centre = centerOf(shape);
  const start = anchor && containsPoint(shape, anchor) ? anchor : centre;
  return outlinePoint(shape, start, towards)
    ?? outlinePoint(shape, centre, towards)
    ?? { x: (anchor ?? centre).x, y: (anchor ?? centre).y };
}

/** Crop the first waypoint to `source` and the last to `target`, keeping segment directions. */
export function cropWaypoints(waypoints: readonly Point[], source?: CroppableShape, target?: CroppableShape): Point[] {
  const points = waypoints.map((p) => ({ x: p.x, y: p.y }));
  if (points.length < 2) return points;
  if (source) points[0] = cropPoint(source, points[1], projectOnto(centerOf(source), points[0], points[1]));
  if (target) {
    const last = points.length - 1;
    points[last] = cropPoint(target, points[last - 1], projectOnto(centerOf(target), points[last], points[last - 1]));
  }
  return points;
}

function projectOnto(point: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < EPSILON) return { x: a.x, y: a.y };
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
  return { x: a.x + t * dx, y: a.y + t * dy };
}
