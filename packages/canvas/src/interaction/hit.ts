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
 * inside a pool both stay clickable. Among overlapping nodes of the same class the
 * deepest / last-drawn one wins, matching the renderer's ancestors-first draw order
 * (`render/renderer.ts` `renderScene`).
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
}

const DEFAULT_TOLERANCE = 5;

/**
 * Every node of `scene` in draw order (bottom → top): ancestors first, so a child
 * container's contents sit after (above) it. Mirrors `renderScene`'s stable depth
 * sort, so the *last* node containing a point is the topmost one.
 */
export function orderedNodes(scene: Scene): SceneNode[] {
  const nodes: SceneNode[] = [];
  for (const element of scene.elementsById.values()) {
    // What a collapsed container hides is not drawn, so it cannot be clicked either
    // (`model/expand.ts`) — the collapsed container itself takes the hit.
    if (isNode(element) && !isHiddenByCollapse(element)) nodes.push(element);
  }
  // Stable sort by containment depth (ancestors first). Array.prototype.sort is
  // stable in modern engines, preserving document (insertion) order within a depth.
  nodes.sort((a, b) => depthOf(a) - depthOf(b));
  return nodes;
}

/** Every edge of `scene`, in document order (what a collapse hides is left out). */
export function orderedEdges(scene: Scene): SceneEdge[] {
  const edges: SceneEdge[] = [];
  for (const element of scene.elementsById.values()) {
    if (isEdge(element) && !isHiddenByCollapse(element)) edges.push(element);
  }
  return edges;
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
  const nodes = orderedNodes(scene);
  let container: SceneNode | undefined;
  // Reverse draw order → topmost first.
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (!pointInNode(point, node, nodePadding)) continue;
    if (!isContainerNode(node)) return node;
    // Remember the innermost/topmost frame, but keep looking for a leaf below it:
    // a `bpmn:Group` is an artifact, so the shapes it frames are not its children
    // and may well be drawn before it.
    container ??= node;
  }

  return nearestEdge(scene, point, options.tolerance ?? DEFAULT_TOLERANCE) ?? container;
}

/**
 * The edge whose polyline is nearest `point`, when within `tolerance`. An edge's
 * drawn NAME counts as part of it: a connection label sits off the line (that is the
 * point of it), and clicking the text a user can see must select the connection it
 * names — the same affordance diagram-js gets from registering the label as its own
 * element. The box is {@link edgeLabelBounds}, shared with the drawer.
 */
function nearestEdge(scene: Scene, point: Point, tolerance: number): SceneEdge | undefined {
  let best: SceneEdge | undefined;
  let bestDist = tolerance;
  for (const edge of orderedEdges(scene)) {
    const d = distanceToPolyline(point, edge.waypoints);
    if (d <= bestDist) {
      bestDist = d;
      best = edge;
    }
  }
  if (best) return best;
  for (const edge of orderedEdges(scene)) {
    if (pointInEdgeLabel(point, edge)) return edge;
  }
  return undefined;
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

/**
 * SVG `elementFromPoint` fast path for real browsers (design §3). Resolves the
 * element id off the nearest ancestor carrying `data-element-id`, then looks it up
 * in the scene. Returns `undefined` under jsdom (no `elementFromPoint`) so callers
 * fall back to {@link hitTest}.
 */
export function hitTestDom(
  scene: Scene,
  doc: Document,
  clientX: number,
  clientY: number,
): SceneElement | undefined {
  const from = (doc as Document & {
    elementFromPoint?: (x: number, y: number) => Element | null;
  }).elementFromPoint;
  if (typeof from !== 'function') return undefined;
  let el: Element | null = from.call(doc, clientX, clientY);
  while (el) {
    const id = el.getAttribute?.('data-element-id');
    if (id) {
      const found = scene.elementsById.get(id);
      if (found && (isNode(found) || isEdge(found))) return found;
    }
    el = el.parentElement;
  }
  return undefined;
}

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
