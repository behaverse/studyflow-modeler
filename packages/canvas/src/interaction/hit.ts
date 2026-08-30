/**
 * Hit-testing (design §3 `interaction/hit.ts`, §6 P2). Maps a point in diagram
 * (untransformed) coordinates to the topmost {@link SceneElement} under it.
 *
 * The PRIMARY path is geometry-based so it works under jsdom, which has no layout
 * engine and therefore no `elementFromPoint`. An optional SVG `elementFromPoint`
 * fast path is provided for real browsers, but it is never relied upon by the
 * geometry tests.
 *
 * Priority mirrors diagram-js's z-order rather than the raw SVG layer stack:
 *
 *   leaf shapes  >  edges  >  container frames (pool, lane, group, expanded subprocess)
 *
 * Containers paint a frame around a transparent interior, so they must not swallow
 * the elements they enclose — a task inside a `bpmn:Group` and a sequence flow
 * inside a pool both stay clickable. Among overlapping LEAF shapes the deepest /
 * last-drawn one wins, matching the renderer's ancestors-first draw order
 * (`render/renderer.ts` `renderScene`); among overlapping FRAMES the innermost wins
 * by geometry instead of by paint order (see {@link outranksFrame}).
 */

import { isHiddenByCollapse } from '@canvas/model/expand.ts';
import { prop } from '@canvas/model/moddle.ts';
import type { Point, Scene, SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import { depthOf } from '@canvas/model/tree.ts';
import { edgeLabelBounds } from '@canvas/render/labels.ts';

/** Options for {@link hitTest}. */
export interface HitOptions {
  /** How close (in diagram units) a point must be to an edge polyline to hit it. Default `5`. */
  tolerance?: number;
  /** Padding (diagram units) grown around node bounds before the inside test. Default `0`. */
  nodePadding?: number;
  /**
   * Restrict what may be hit at all — an element the predicate rejects is invisible
   * to the query and whatever lies under it takes the hit instead. This is how a
   * drill-down PLANE scopes the editor (`Canvas.setPlaneScope`): the elements of
   * another plane are neither drawn nor clickable. Default: everything is eligible.
   */
  accept?: (element: SceneElement) => boolean;
}

const DEFAULT_TOLERANCE = 5;

/**
 * The draw-order index of one scene: every node depth-sorted, every edge in
 * document order. Rebuilt only when the document moves.
 *
 * A pointer frame asks for this several times over (a container pass, an edge pass,
 * a label pass, and again from {@link nodesIntersecting} while a marquee is live),
 * and a drag asks once per `pointermove`. Rebuilding it meant a full scan of
 * `elementsById` plus an `O(n log n)` sort with a {@link depthOf} walk per
 * comparison, every frame, for an ordering that changes only when an element is
 * added, removed or reparented — and every one of those goes through
 * `Writeback.finish`, which bumps `Scene.revision`. So the revision is the key.
 *
 * What is deliberately NOT in here:
 *
 * - **Geometry.** A node's `x`/`y` moves continuously mid-drag and never affects
 *   the ordering, so a live gesture reuses the cached index — the case this exists
 *   for in the first place.
 * - **Visibility.** `isHiddenByCollapse` is applied at QUERY time, by
 *   {@link orderedNodes} / {@link orderedEdges}, because it is not revision-stable:
 *   drilling into a sub-process sets `SceneNode.isExpanded` on the containers along
 *   the way as pure VIEW state (`view/plane.ts`), writing nothing and bumping
 *   nothing. Caching it made a drill-down's children permanently unclickable.
 *
 * An import mints a whole new {@link Scene}, and the `WeakMap` lets the old one's
 * index go with it.
 */
interface DrawOrder {
  revision: number;
  nodes: SceneNode[];
  edges: SceneEdge[];
}

const drawOrders = new WeakMap<Scene, DrawOrder>();

function drawOrderOf(scene: Scene): DrawOrder {
  const cached = drawOrders.get(scene);
  if (cached && cached.revision === scene.revision) return cached;

  const nodes: SceneNode[] = [];
  const edges: SceneEdge[] = [];
  for (const element of scene.elementsById.values()) {
    if (isNode(element)) nodes.push(element);
    else if (isEdge(element)) edges.push(element);
  }
  // Stable sort by containment depth (ancestors first). Array.prototype.sort is
  // stable in modern engines, preserving document (insertion) order within a depth.
  nodes.sort((a, b) => depthOf(a) - depthOf(b));

  const order: DrawOrder = { revision: scene.revision, nodes, edges };
  drawOrders.set(scene, order);
  return order;
}

/**
 * Every VISIBLE node of `scene` in draw order (bottom → top): ancestors first, so a
 * child container's contents sit after (above) it. Mirrors `renderScene`'s stable
 * depth sort, so the *last* node containing a point is the topmost one.
 *
 * What a collapsed container hides is not drawn, so it cannot be clicked either
 * (`model/expand.ts`) — the collapsed container itself takes the hit.
 */
export function orderedNodes(scene: Scene): SceneNode[] {
  return drawOrderOf(scene).nodes.filter((node) => !isHiddenByCollapse(node));
}

/** Every visible edge of `scene`, in document order. See {@link orderedNodes}. */
export function orderedEdges(scene: Scene): SceneEdge[] {
  return drawOrderOf(scene).edges.filter((edge) => !isHiddenByCollapse(edge));
}

/**
 * The topmost {@link SceneElement} under `point` (diagram coordinates), or
 * `undefined` for empty space.
 *
 * Leaf shapes win outright. Failing that, an edge within `tolerance` of its
 * polyline wins over any container frame the point also falls in; only when no
 * edge is near does the innermost container itself get selected.
 */
export function hitTest(scene: Scene, point: Point, options: HitOptions = {}): SceneElement | undefined {
  const nodePadding = options.nodePadding ?? 0;
  const accept = options.accept;
  const nodes = orderedNodes(scene);
  let container: SceneNode | undefined;
  // Reverse draw order → topmost first.
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (accept && !accept(node)) continue;
    if (!pointInNode(point, node, nodePadding)) continue;
    if (!isContainerNode(node)) return node;
    // Remember the innermost frame, but keep looking for a leaf below it: a
    // `bpmn:Group` is an artifact, so the shapes it frames are not its children
    // and may well be drawn before it.
    if (!container || outranksFrame(node, container)) container = node;
  }

  return nearestEdge(scene, point, options.tolerance ?? DEFAULT_TOLERANCE, accept) ?? container;
}

/**
 * Whether frame `candidate` should be preferred over the frame `current` already
 * found under the same point — i.e. whether it is the more INNER of the two.
 *
 * Paint order cannot answer this. Frames overlap without nesting in the document:
 * a `bpmn:Group` is an *artifact*, so the activities it visually frames are not its
 * children, and it is drawn after (above) them. Ranking by draw order therefore
 * handed every point of an expanded sub-process that a group happens to overlap to
 * the GROUP — the sub-process could not be double-clicked shut over the upper half
 * of its own frame, and the gesture opened a rename on the group instead.
 *
 * So rank by geometry, which is what "innermost" means to a user aiming at a frame:
 *
 * - The smaller-area frame wins. A frame nested inside another always has the
 *   smaller area, so genuine nesting (lane in pool, sub-process in group, group in
 *   sub-process) is ranked correctly whichever way round the document nests it,
 *   and partial overlaps fall out sensibly too.
 * - On equal area — two frames drawn exactly on top of each other — the deeper one
 *   in the containment tree wins.
 * - Failing both, the first frame reached wins, i.e. the topmost in draw order.
 */
function outranksFrame(candidate: SceneNode, current: SceneNode): boolean {
  const candidateArea = candidate.width * candidate.height;
  const currentArea = current.width * current.height;
  if (candidateArea !== currentArea) return candidateArea < currentArea;
  return depthOf(candidate) > depthOf(current);
}

/**
 * The edge whose polyline is nearest `point`, when within `tolerance`. An edge's
 * drawn NAME counts as part of it: a connection label sits off the line (that is the
 * point of it), and clicking the text a user can see must select the connection it
 * names — the same affordance diagram-js gets from registering the label as its own
 * element. The box is {@link edgeLabelBounds}, shared with the drawer.
 *
 * One pass over the edges answers both questions: the line always outranks a label,
 * so the first label hit is remembered but only returned when no line came within
 * `tolerance`.
 */
function nearestEdge(
  scene: Scene,
  point: Point,
  tolerance: number,
  accept?: (element: SceneElement) => boolean,
): SceneEdge | undefined {
  let best: SceneEdge | undefined;
  let bestDist = tolerance;
  let labelled: SceneEdge | undefined;
  for (const edge of orderedEdges(scene)) {
    if (accept && !accept(edge)) continue;
    const d = distanceToPolyline(point, edge.waypoints);
    if (d <= bestDist) {
      bestDist = d;
      best = edge;
    } else if (!best && !labelled && pointInEdgeLabel(point, edge)) {
      labelled = edge;
    }
  }
  return best ?? labelled;
}

/** Whether `point` falls in the box an edge's name is painted into. */
function pointInEdgeLabel(point: Point, edge: SceneEdge): boolean {
  const name = prop(edge.businessObject, 'name');
  if (typeof name !== 'string' || !name) return false;
  const box = edgeLabelBounds(edge, name, edge.label);
  return point.x >= box.x && point.x <= box.x + box.width
    && point.y >= box.y && point.y <= box.y + box.height;
}

/**
 * Whether `node` paints as a frame around a transparent interior — a pool, a lane, a
 * `bpmn:Group` artifact, an expanded subprocess — rather than as an opaque shape.
 * Frames never shadow the elements they enclose during hit-testing. A *collapsed*
 * subprocess (`isExpanded === false`, drawn task-sized by `render/renderer.ts`) is an
 * opaque shape, not a frame.
 */
export function isContainerNode(node: SceneNode): boolean {
  if (SUBPROCESS_TYPES.has(node.type)) return node.isExpanded !== false;
  if (FRAME_TYPES.has(node.type)) return true;
  return node.children.length > 0;
}

/** Activity types drawn as a frame only while expanded. */
const SUBPROCESS_TYPES = new Set([
  'bpmn:SubProcess',
  'bpmn:AdHocSubProcess',
  'bpmn:Transaction',
]);

/** Types always drawn as a frame. */
const FRAME_TYPES = new Set([
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:Group',
]);

/** Whether `point` lies inside `node`'s (padded) axis-aligned bounds. */
export function pointInNode(point: Point, node: SceneNode, padding = 0): boolean {
  return (
    point.x >= node.x - padding
    && point.x <= node.x + node.width + padding
    && point.y >= node.y - padding
    && point.y <= node.y + node.height + padding
  );
}

/** Nodes of `scene` whose bounds intersect `rect` (diagram coords) — for marquee. */
export function nodesIntersecting(scene: Scene, rect: {
  x: number; y: number; width: number; height: number;
}): SceneNode[] {
  const r = normalizeRect(rect);
  const out: SceneNode[] = [];
  for (const node of orderedNodes(scene)) {
    if (rectsIntersect(r, { x: node.x, y: node.y, width: node.width, height: node.height })) {
      out.push(node);
    }
  }
  return out;
}

// --- helpers ----------------------------------------------------------------

function isNode(el: SceneElement | { kind: string }): el is SceneNode {
  return el.kind === 'node';
}

function isEdge(el: SceneElement | { kind: string }): el is SceneEdge {
  return el.kind === 'edge';
}

/** Shortest distance from `point` to a polyline (its segments), or `Infinity`. */
export function distanceToPolyline(point: Point, waypoints: readonly Point[]): number {
  if (waypoints.length === 0) return Infinity;
  if (waypoints.length === 1) return Math.hypot(point.x - waypoints[0].x, point.y - waypoints[0].y);
  let min = Infinity;
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const d = pointToSegment(point, waypoints[i], waypoints[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

/** Distance from `p` to segment `a`–`b`. */
function pointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

interface Rect { x: number; y: number; width: number; height: number; }

/** Normalize a rect so width/height are non-negative. */
export function normalizeRect(r: Rect): Rect {
  const x = r.width < 0 ? r.x + r.width : r.x;
  const y = r.height < 0 ? r.y + r.height : r.y;
  return { x, y, width: Math.abs(r.width), height: Math.abs(r.height) };
}

/** Axis-aligned rectangle overlap (touching edges count as intersecting). */
function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width
    && a.x + a.width >= b.x
    && a.y <= b.y + b.height
    && a.y + a.height >= b.y
  );
}
