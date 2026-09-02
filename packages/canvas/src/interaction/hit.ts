/**
 * Hit-testing in diagram coordinates. Priority: labels, then leaf shapes, then
 * edges within tolerance, then the innermost container frame.
 */

import type { Bounds, Point, Scene, SceneEdge, SceneElement, SceneLabel, SceneNode } from '@canvas/model/scene.ts';
import { depthOf, isHidden } from '@canvas/model/tree.ts';

export interface HitOptions {
  /** How close a point must be to an edge to hit it. Default `5`. */
  tolerance?: number;
  nodePadding?: number;
  /** An element the predicate rejects is invisible to the query. */
  accept?: (element: SceneElement) => boolean;
}

const DEFAULT_TOLERANCE = 5;

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

export function orderedNodes(scene: Scene): SceneNode[] {
  return drawOrderOf(scene).nodes.filter((node) => !isHidden(node, scene.scope));
}

export function orderedEdges(scene: Scene): SceneEdge[] {
  return drawOrderOf(scene).edges.filter((edge) => !isHidden(edge, scene.scope));
}

export function visibleLabels(scene: Scene): SceneLabel[] {
  const out: SceneLabel[] = [];
  for (const element of scene.elementsById.values()) {
    if (element.kind === 'label' && !isHidden(element, scene.scope)) out.push(element);
  }
  return out;
}

export function hitTest(scene: Scene, point: Point, options: HitOptions = {}): SceneElement | undefined {
  const accept = options.accept;
  for (const label of visibleLabels(scene).reverse()) {
    if (accept && !accept(label)) continue;
    if (pointInBox(point, label)) return label;
  }
  const nodes = orderedNodes(scene);
  let container: SceneNode | undefined;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (accept && !accept(node)) continue;
    if (!pointInNode(point, node, options.nodePadding ?? 0)) continue;
    if (!isContainerNode(node)) return node;
    if (!container || outranksFrame(node, container)) container = node;
  }
  return nearestEdge(scene, point, options.tolerance ?? DEFAULT_TOLERANCE, accept) ?? container;
}

/** The smaller frame is the inner one; on a tie, the deeper. */
function outranksFrame(candidate: SceneNode, current: SceneNode): boolean {
  const a = candidate.width * candidate.height;
  const b = current.width * current.height;
  if (a !== b) return a < b;
  return depthOf(candidate) > depthOf(current);
}

function nearestEdge(scene: Scene, point: Point, tolerance: number, accept?: (element: SceneElement) => boolean): SceneEdge | undefined {
  let best: SceneEdge | undefined;
  let bestDist = tolerance;
  for (const edge of orderedEdges(scene)) {
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
export function isContainerNode(node: SceneNode): boolean {
  if (SUBPROCESS_TYPES.has(node.type)) return node.isExpanded !== false;
  if (FRAME_TYPES.has(node.type)) return true;
  return node.children.length > 0;
}

export function pointInBox(point: Point, box: Bounds, padding = 0): boolean {
  return point.x >= box.x - padding && point.x <= box.x + box.width + padding
    && point.y >= box.y - padding && point.y <= box.y + box.height + padding;
}

export function pointInNode(point: Point, node: SceneNode, padding = 0): boolean {
  return pointInBox(point, node, padding);
}

export function nodesIntersecting(scene: Scene, rect: Bounds): SceneNode[] {
  const r = normalizeRect(rect);
  return orderedNodes(scene).filter((node) => rectsIntersect(r, node));
}

/** Edges whose route passes through `rect`. */
export function edgesIntersecting(scene: Scene, rect: Bounds): SceneEdge[] {
  const r = normalizeRect(rect);
  return orderedEdges(scene).filter((edge) => {
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

export function distanceToPolyline(point: Point, waypoints: readonly Point[]): number {
  if (waypoints.length === 0) return Infinity;
  if (waypoints.length === 1) return Math.hypot(point.x - waypoints[0].x, point.y - waypoints[0].y);
  let min = Infinity;
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    min = Math.min(min, pointToSegment(point, waypoints[i], waypoints[i + 1]));
  }
  return min;
}

function pointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function normalizeRect(r: Bounds): Bounds {
  const x = r.width < 0 ? r.x + r.width : r.x;
  const y = r.height < 0 ? r.y + r.height : r.y;
  return { x, y, width: Math.abs(r.width), height: Math.abs(r.height) };
}

function rectsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}
