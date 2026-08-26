/**
 * Endpoint cropping — pull an edge endpoint from inside a shape out to the point
 * where it meets that shape's *drawn* outline (design §3 `routing/crop.ts`, §2
 * "All routed orthogonally with endpoint cropping to the shape outline").
 *
 * This is the counterpart of diagram-js's `cropConnection`: the router
 * (`routing/orthogonal.ts`) lays out a path whose first and last waypoints sit at
 * the shape CENTRES, and cropping trims those two segments back to the silhouette
 * so the arrowhead touches the border instead of the middle of the shape.
 *
 * Two properties matter and are both deliberate:
 *
 * 1. **The outline is the one the renderer draws** — a circle for an event
 *    (36×36 ⇒ r=18), a diamond for a gateway, a dog-eared page for a data object,
 *    a cylinder for a data store, a rectangle for everything else. The mapping
 *    reuses `render/renderer.ts`'s {@link categoryOf} so the two can never drift.
 * 2. **Cropping never breaks orthogonality.** The cropped point is found by
 *    walking along the LINE OF THE INCIDENT SEGMENT (anchored at the projection of
 *    the shape centre onto that line), not along the centre→neighbour ray. An
 *    axis-aligned segment therefore stays axis-aligned — only its length changes.
 *
 * Everything here is pure geometry: no DOM, no moddle, no scene mutation. Shapes
 * are taken as {@link CroppableShape} (bounds + optional BPMN type), which a
 * `SceneNode` satisfies structurally, so the routing tests can use plain objects.
 */

import { BPMN } from '@core/constants.ts';

import type { Bounds, Point } from '@canvas/model/scene.ts';
import { categoryOf } from '@canvas/render/renderer.ts';

/** Anything the cropper can trim to: DI bounds plus the business-object `$type`. */
export interface CroppableShape extends Bounds {
  /** Business-object `$type` (`'bpmn:UserTask'`); absent ⇒ treated as a rectangle. */
  readonly type?: string;
}

/**
 * The silhouette family a shape is cropped against. Mirrors the drawers in
 * `render/shapes.ts`: `ellipse` ↔ `drawEvent`, `diamond` ↔ `drawDiamond`,
 * `dataObject` ↔ `drawDataObject`, `dataStore` ↔ `drawDataStore`, `rect` ↔
 * `drawTask`/`drawGroup`/`drawParticipant`/`drawTextAnnotation` and the
 * choreography bands.
 */
export type Outline = 'rect' | 'ellipse' | 'diamond' | 'dataObject' | 'dataStore';

/** Fold size of a data object's dog ear — must match `drawDataObject`. */
const DATA_FOLD_RATIO = 0.32;

/** Cap height of a data store cylinder — must match `drawDataStore`. */
const DATA_STORE_CAP_RATIO = 0.12;
const DATA_STORE_MAX_CAP = 8;

/** Tolerance for "is this direction axis-parallel" / containment slack. */
const EPSILON = 1e-9;

// --- outline selection ------------------------------------------------------

/** The outline a business-object `$type` is drawn with (`'bpmn:EndEvent'` → `'ellipse'`). */
export function outlineFor(type: string | undefined): Outline {
  if (!type) return 'rect';
  switch (categoryOf(type)) {
    case 'event':
      return 'ellipse';
    case 'gateway':
      return 'diamond';
    case 'data':
      return type === BPMN.DataStoreReference || type === BPMN.DataStore
        ? 'dataStore'
        : 'dataObject';
    default:
      // Tasks, (collapsed or expanded) subprocesses, choreography tasks, pools,
      // lanes, groups and text annotations are all rectangular silhouettes.
      return 'rect';
  }
}

/** Centre of a bounds box. */
export function centerOf(bounds: Bounds): Point {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

// --- containment ------------------------------------------------------------

/** Whether `point` lies inside (or on) `shape`'s drawn outline. */
export function containsPoint(shape: CroppableShape, point: Point): boolean {
  const outline = outlineFor(shape.type);
  const { x, y, width: w, height: h } = shape;
  if (w <= 0 || h <= 0) return false;
  const inBox = point.x >= x - EPSILON && point.x <= x + w + EPSILON
    && point.y >= y - EPSILON && point.y <= y + h + EPSILON;

  switch (outline) {
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
      // Rectangle minus the folded top-right triangle (a convex intersection).
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

/** `X − Y` along the dog-ear fold line, i.e. the half-plane the page keeps. */
function foldConstant(shape: Bounds): number {
  const fold = Math.min(shape.width, shape.height) * DATA_FOLD_RATIO;
  return shape.x + shape.width - fold - shape.y;
}

/** Half-height of a data store's elliptical cap. */
function capHeight(shape: Bounds): number {
  return Math.min(shape.height * DATA_STORE_CAP_RATIO, DATA_STORE_MAX_CAP);
}

// --- ray/outline intersection ----------------------------------------------

/**
 * The point where the ray from `from` (which must lie inside `shape`) towards
 * `towards` leaves the shape's outline, or `undefined` when `from` is outside, the
 * direction is degenerate, or the shape has no extent.
 */
export function outlinePoint(
  shape: CroppableShape,
  from: Point,
  towards: Point,
): Point | undefined {
  const dx = towards.x - from.x;
  const dy = towards.y - from.y;
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return undefined;
  if (shape.width <= 0 || shape.height <= 0) return undefined;
  if (!containsPoint(shape, from)) return undefined;

  const t = exitT(shape, from, dx, dy);
  if (t === undefined || !Number.isFinite(t) || t < 0) return undefined;
  return { x: from.x + dx * t, y: from.y + dy * t };
}

/** Ray parameter at which the ray leaves the shape (every outline is convex). */
function exitT(shape: CroppableShape, p: Point, dx: number, dy: number): number | undefined {
  switch (outlineFor(shape.type)) {
    case 'rect':
      return rectExitT(shape, p, dx, dy);
    case 'ellipse':
      return ellipseExitT(
        shape.x + shape.width / 2, shape.y + shape.height / 2,
        shape.width / 2, shape.height / 2,
        p, dx, dy,
      );
    case 'diamond':
      return diamondExitT(shape, p, dx, dy);
    case 'dataObject':
      return minDefined(rectExitT(shape, p, dx, dy), foldExitT(shape, p, dx, dy));
    case 'dataStore':
      return cylinderExitT(shape, p, dx, dy);
  }
}

/** Smaller of two optional non-negative ray parameters. */
function minDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

/** Exit against an axis-aligned box (slab clipping from an interior point). */
function rectExitT(box: Bounds, p: Point, dx: number, dy: number): number | undefined {
  let t = Infinity;
  if (dx > EPSILON) t = Math.min(t, (box.x + box.width - p.x) / dx);
  else if (dx < -EPSILON) t = Math.min(t, (box.x - p.x) / dx);
  if (dy > EPSILON) t = Math.min(t, (box.y + box.height - p.y) / dy);
  else if (dy < -EPSILON) t = Math.min(t, (box.y - p.y) / dy);
  return Number.isFinite(t) ? Math.max(0, t) : undefined;
}

/**
 * Where the ray meets an ellipse centred at `(cx, cy)` with radii `(rx, ry)`, as
 * ray parameters in ascending order (empty when it misses). Two roots are returned
 * even for a ray starting outside the ellipse — the data-store caps need that, as
 * the cylinder's centre lies outside both of them.
 */
function ellipseRoots(
  cx: number, cy: number, rx: number, ry: number,
  p: Point, dx: number, dy: number,
): number[] {
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

/** Exit against an ellipse from an interior point — the first non-negative root. */
function ellipseExitT(
  cx: number, cy: number, rx: number, ry: number,
  p: Point, dx: number, dy: number,
): number | undefined {
  for (const t of ellipseRoots(cx, cy, rx, ry, p, dx, dy)) {
    if (t >= -EPSILON) return Math.max(0, t);
  }
  return undefined;
}

/** Exit against a rhombus inscribed in `box` (|u| + |v| = 1). */
function diamondExitT(box: Bounds, p: Point, dx: number, dy: number): number | undefined {
  const rx = box.width / 2;
  const ry = box.height / 2;
  const cx = box.x + rx;
  const cy = box.y + ry;
  const ux = (p.x - cx) / rx;
  const uy = (p.y - cy) / ry;
  const vx = dx / rx;
  const vy = dy / ry;
  let best: number | undefined;
  // The four edges are the lines sx·u + sy·v = 1; keep the nearest hit that
  // actually lands on its own quadrant.
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

/** Exit against the dog-ear fold line of a data object. */
function foldExitT(shape: Bounds, p: Point, dx: number, dy: number): number | undefined {
  const denom = dx - dy;
  if (denom <= EPSILON) return undefined; // moving away from (or along) the fold
  const t = (foldConstant(shape) - (p.x - p.y)) / denom;
  return t >= 0 ? t : undefined;
}

/** Exit against a cylinder: vertical flanks plus two elliptical caps. */
function cylinderExitT(shape: Bounds, p: Point, dx: number, dy: number): number | undefined {
  const { x, y, width: w, height: h } = shape;
  const rx = w / 2;
  const ry = capHeight(shape);
  const cx = x + rx;
  let best: number | undefined;

  // Flanks — valid only between the caps.
  let tSide: number | undefined;
  if (dx > EPSILON) tSide = (x + w - p.x) / dx;
  else if (dx < -EPSILON) tSide = (x - p.x) / dx;
  if (tSide !== undefined && tSide >= 0) {
    const hitY = p.y + tSide * dy;
    if (hitY >= y + ry - EPSILON && hitY <= y + h - ry + EPSILON) best = tSide;
  }

  // Caps — the upper half of the top ellipse, the lower half of the bottom one.
  // The cylinder's interior reaches ABOVE the top cap's centre, so the ray may
  // cross that ellipse twice; the exit is the first crossing that is both ahead of
  // us and on the bulging half.
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

// --- endpoint cropping ------------------------------------------------------

/**
 * The point on `shape`'s outline in the direction of `towards`, walking along the
 * line that carries the incident segment so an axis-aligned segment stays
 * axis-aligned.
 *
 * `anchor` is the point the walk starts from; it defaults to the shape centre.
 * When it does not lie inside the outline (a lane placed off the shape, a
 * degenerate box) the centre is used instead, and if even that fails the raw
 * `anchor` is returned unchanged — cropping never invents a point in mid-air.
 */
export function cropPoint(shape: CroppableShape, towards: Point, anchor?: Point): Point {
  const centre = centerOf(shape);
  const start = anchor && containsPoint(shape, anchor) ? anchor : centre;
  return outlinePoint(shape, start, towards)
    ?? outlinePoint(shape, centre, towards)
    ?? { x: (anchor ?? centre).x, y: (anchor ?? centre).y };
}

/**
 * Crop the first waypoint to `source`'s outline and the last to `target`'s,
 * preserving the direction of the incident segments. Returns a fresh list; a path
 * with fewer than two points, or an endpoint whose shape is missing, is passed
 * through untouched.
 *
 * The anchor for each end is the projection of that shape's centre onto the
 * incident segment's line — for the axis-aligned paths the router produces this is
 * exactly "slide the endpoint along its own segment until it hits the border".
 */
export function cropWaypoints(
  waypoints: readonly Point[],
  source?: CroppableShape,
  target?: CroppableShape,
): Point[] {
  const points = waypoints.map((p) => ({ x: p.x, y: p.y }));
  if (points.length < 2) return points;

  if (source) {
    const next = points[1];
    points[0] = cropPoint(source, next, projectOnto(centerOf(source), points[0], next));
  }
  if (target) {
    const last = points.length - 1;
    const prev = points[last - 1];
    points[last] = cropPoint(target, prev, projectOnto(centerOf(target), points[last], prev));
  }
  return points;
}

/** Orthogonal projection of `point` onto the infinite line through `a` and `b`. */
function projectOnto(point: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < EPSILON) return { x: a.x, y: a.y };
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
  return { x: a.x + t * dx, y: a.y + t * dy };
}
