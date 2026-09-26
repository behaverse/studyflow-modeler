/**
 * Hit-testing in diagram coordinates. Priority: labels, then leaf shapes, then
 * edges within tolerance, then the innermost container frame.
 */

import type { Bounds, Point, Scene, SceneEdge, SceneElement, SceneLabel, SceneNode } from '@canvas/study/scene.ts';
import { depthOf, isHidden } from '@canvas/study/tree.ts';
import { distanceToSegment } from '@canvas/study/edit.ts';

export interface HitOptions {
  /** The container the view is drilled into: what lies outside it is invisible to the query. */
  scope?: SceneNode;
  /** An element the predicate rejects is invisible to the query. */
  accept?: (element: SceneElement) => boolean;
}

/** How close a point must be to an edge to hit it. */
const EDGE_TOLERANCE = 5;

interface DrawOrder {
  revision: number;
  nodes: SceneNode[];
  edges: SceneEdge[];
}

const drawOrders = new WeakMap<Scene, DrawOrder>();

/** Nodes depth-sorted and edges in document order, rebuilt when the revision moves. */
function drawOrderOf(scene: Scene): DrawOrder {
  const cached = drawOrders.get(scene);
  if (cached && cached.revision === scene.revision) return cached;
  const nodes: SceneNode[] = [];
  const edges: SceneEdge[] = [];
  for (const element of scene.elementsById.values()) {
    if (element.kind === 'node') nodes.push(element);
    else if (element.kind === 'edge') edges.push(element);
  }
  nodes.sort((a, b) => depthOf(a) - depthOf(b));
  const order = { revision: scene.revision, nodes, edges };
  drawOrders.set(scene, order);
  return order;
}

export function orderedNodes(scene: Scene, scope?: SceneNode): SceneNode[] {
  return drawOrderOf(scene).nodes.filter((node) => !isHidden(node, scope));
}

function orderedEdges(scene: Scene, scope?: SceneNode): SceneEdge[] {
  return drawOrderOf(scene).edges.filter((edge) => !isHidden(edge, scope));
}

function visibleLabels(scene: Scene, scope?: SceneNode): SceneLabel[] {
  const out: SceneLabel[] = [];
  for (const element of scene.elementsById.values()) {
    if (element.kind === 'label' && !isHidden(element, scope)) out.push(element);
  }
  return out;
}

export function hitTest(scene: Scene, point: Point, options: HitOptions = {}): SceneElement | undefined {
  const accept = options.accept;
  for (const label of visibleLabels(scene, options.scope).reverse()) {
    if (accept && !accept(label)) continue;
    if (pointInBox(point, label)) return label;
  }
  const nodes = orderedNodes(scene, options.scope);
  let container: SceneNode | undefined;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (accept && !accept(node)) continue;
    if (!pointInBox(point, node)) continue;
    if (!isContainerNode(node)) return node;
    if (!container || outranksFrame(node, container)) container = node;
  }
  return nearestEdge(scene, point, options) ?? container;
}

/** The smaller frame is the inner one; on a tie, the deeper. */
function outranksFrame(candidate: SceneNode, current: SceneNode): boolean {
  const a = candidate.width * candidate.height;
  const b = current.width * current.height;
  if (a !== b) return a < b;
  return depthOf(candidate) > depthOf(current);
}

function nearestEdge(scene: Scene, point: Point, { scope, accept }: HitOptions): SceneEdge | undefined {
  let best: SceneEdge | undefined;
  let bestDist = EDGE_TOLERANCE;
  for (const edge of orderedEdges(scene, scope)) {
    if (accept && !accept(edge)) continue;
    const d = distanceToPolyline(point, edge.waypoints);
    if (d <= bestDist) {
      bestDist = d;
      best = edge;
    }
  }
  return best;
}

const SUBPROCESS_TYPES = new Set(['bpmn:SubProcess', 'bpmn:AdHocSubProcess', 'bpmn:Transaction']);
const FRAME_TYPES = new Set(['bpmn:Participant', 'bpmn:Lane', 'bpmn:Group']);

/** A frame around a transparent interior never shadows what it encloses. */
/** The node a drop onto `hit` lands in: the node itself, a caption's owner's, or a flow's container. */
export function containerOf(hit: SceneElement | undefined): SceneNode | undefined {
  if (!hit) return undefined;
  if (hit.kind === 'node') return hit;
  if (hit.kind === 'label') return containerOf(hit.owner);
  return hit.parent;
}

/** The boxes a route in `scope` steers around: the shapes shown there that hold nothing, but those in `exclude`. */
export function obstaclesIn(scene: Scene, scope: SceneNode | undefined, exclude: readonly SceneNode[] = []): Bounds[] {
  const skip = new Set<SceneNode>(exclude);
  return orderedNodes(scene, scope)
    .filter((node) => !skip.has(node) && !isContainerNode(node))
    .map((node) => ({ x: node.x, y: node.y, width: node.width, height: node.height }));
}

export function isContainerNode(node: SceneNode): boolean {
  if (SUBPROCESS_TYPES.has(node.type)) return node.isExpanded !== false;
  if (FRAME_TYPES.has(node.type)) return true;
  return node.children.length > 0;
}

export function pointInBox(point: Point, box: Bounds, padding = 0): boolean {
  return point.x >= box.x - padding && point.x <= box.x + box.width + padding
    && point.y >= box.y - padding && point.y <= box.y + box.height + padding;
}

export function nodesIntersecting(scene: Scene, rect: Bounds, scope?: SceneNode): SceneNode[] {
  const r = normalizeRect(rect);
  return orderedNodes(scene, scope).filter((node) => rectsIntersect(r, node));
}

/** Edges whose route passes through `rect`. */
export function edgesIntersecting(scene: Scene, rect: Bounds, scope?: SceneNode): SceneEdge[] {
  const r = normalizeRect(rect);
  return orderedEdges(scene, scope).filter((edge) => {
    const points = edge.waypoints;
    for (let i = 0; i < points.length - 1; i += 1) {
      if (segmentIntersectsRect(points[i], points[i + 1], r)) return true;
    }
    return false;
  });
}

/** Liang–Barsky clip of segment `a`–`b` against `rect`. */
function segmentIntersectsRect(a: Point, b: Point, rect: Bounds): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clips: [number, number][] = [
    [-dx, a.x - rect.x],
    [dx, rect.x + rect.width - a.x],
    [-dy, a.y - rect.y],
    [dy, rect.y + rect.height - a.y],
  ];
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

function distanceToPolyline(point: Point, waypoints: readonly Point[]): number {
  if (waypoints.length === 0) return Infinity;
  if (waypoints.length === 1) return Math.hypot(point.x - waypoints[0].x, point.y - waypoints[0].y);
  let min = Infinity;
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    min = Math.min(min, distanceToSegment(waypoints[i], waypoints[i + 1], point));
  }
  return min;
}

export function normalizeRect(r: Bounds): Bounds {
  const x = r.width < 0 ? r.x + r.width : r.x;
  const y = r.height < 0 ? r.y + r.height : r.y;
  return { x, y, width: Math.abs(r.width), height: Math.abs(r.height) };
}

function rectsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}
