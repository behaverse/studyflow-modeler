/** Containment-tree helpers: depth, z-order, visibility, expansion. */

import type { Bounds, Point, Scene, SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';

export const EXPANDABLE_TYPES: ReadonlySet<string> = new Set([
  'bpmn:SubProcess',
  'bpmn:AdHocSubProcess',
  'bpmn:Transaction',
  'bpmn:SubChoreography',
  'bpmn:CallChoreography',
]);

export const COLLAPSED_SIZE = { width: 100, height: 80 } as const;
export const EXPANDED_SIZE = { width: 350, height: 200 } as const;
/** Inset of a container's contents inside its frame; the top leaves room for the name. */
export const CONTENT_PADDING = { top: 40, right: 30, bottom: 30, left: 30 } as const;

export function isExpandable(type: string): boolean {
  return EXPANDABLE_TYPES.has(type);
}

/** Only an explicit `false` counts: a shape that omits the flag is drawn expanded. */
export function isCollapsed(node: SceneNode): boolean {
  return node.isExpanded === false && isExpandable(node.type);
}

export function isExpanded(node: SceneNode): boolean {
  return node.isExpanded !== false && isExpandable(node.type);
}

/** The frame that holds `contents`, anchored at `origin`'s top-left. */
export function frameAround(origin: Point, contents: Bounds): Bounds {
  const pad = CONTENT_PADDING;
  return {
    x: origin.x,
    y: origin.y,
    width: Math.max(EXPANDED_SIZE.width, contents.width + pad.left + pad.right),
    height: Math.max(EXPANDED_SIZE.height, contents.height + pad.top + pad.bottom),
  };
}

export function depthOf(element: { parent?: SceneNode }): number {
  let depth = 0;
  const guard = new Set<SceneNode>();
  for (let p = element.parent; p && !guard.has(p); p = p.parent) {
    guard.add(p);
    depth += 1;
  }
  return depth;
}

/**
 * Paint order inside the one element layer: shallower first (a container behind
 * its contents), edges before nodes within a depth, a label right after its owner.
 */
export function zRankOf(element: SceneElement): number {
  if (element.kind === 'label') return zRankOf(element.owner);
  if (element.kind === 'edge') {
    const depth = Math.max(
      depthOf(element),
      element.source ? depthOf(element.source) : 0,
      element.target ? depthOf(element.target) : 0,
    );
    return depth * 2;
  }
  return depthOf(element) * 2 + 1;
}

export function isDescendantOf(element: SceneElement, node: SceneNode): boolean {
  const guard = new Set<SceneNode>();
  for (let p = element.parent; p && !guard.has(p); p = p.parent) {
    if (p === node) return true;
    guard.add(p);
  }
  return false;
}

/**
 * Whether `element` is off screen: outside the drill-down `scope`, or inside a
 * collapsed container below it.
 */
export function isHidden(element: SceneElement, scope?: SceneNode): boolean {
  const owner = element.kind === 'label' ? element.owner : element;
  if (scope && !isDescendantOf(owner, scope)) return true;
  for (let p = owner.parent; p && p !== scope; p = p.parent) {
    if (isCollapsed(p)) return true;
  }
  return false;
}

/** The shape actually on screen for an edge end: the outermost collapsed ancestor, if any. */
export function visibleEndpointOf(node: SceneNode, scope?: SceneNode): SceneNode {
  let visible = node;
  for (let p = node.parent; p && p !== scope; p = p.parent) {
    if (isCollapsed(p)) visible = p;
  }
  return visible;
}

/** Every element under `node`, depth-first, containers before their contents. */
export function contentsOf(node: SceneNode): SceneElement[] {
  const out: SceneElement[] = [];
  const visit = (element: SceneElement): void => {
    out.push(element);
    if (element.kind === 'node') for (const child of element.children) visit(child);
  };
  for (const child of node.children) visit(child);
  return out;
}

/** `nodes` plus every node nested inside them, ancestors first, de-duplicated. */
export function withDescendants(nodes: readonly SceneNode[]): SceneNode[] {
  const out: SceneNode[] = [];
  const seen = new Set<SceneNode>();
  const visit = (node: SceneNode): void => {
    if (seen.has(node)) return;
    seen.add(node);
    out.push(node);
    for (const child of node.children) if (child.kind === 'node') visit(child);
  };
  for (const node of nodes) visit(node);
  return out;
}

/** Every edge docked to `node`, each once. */
export function incidentEdgesOf(node: SceneNode): SceneEdge[] {
  const out: SceneEdge[] = [];
  for (const edge of [...node.outgoing, ...node.incoming]) if (!out.includes(edge)) out.push(edge);
  return out;
}

/** Edges with one end inside `node` and the other outside it. */
export function crossingEdgesOf(node: SceneNode): SceneEdge[] {
  const inside = new Set<SceneElement>(contentsOf(node));
  const out: SceneEdge[] = [];
  for (const element of inside) {
    if (element.kind !== 'node') continue;
    for (const edge of incidentEdgesOf(element)) {
      if (out.includes(edge)) continue;
      const other = edge.source === element ? edge.target : edge.source;
      if (!other || other === node || inside.has(other)) continue;
      out.push(edge);
    }
  }
  return out;
}

/** Every edge docked to `elements` (nested children included) plus the edges among them. */
export function edgesAffectedBy(elements: Iterable<SceneElement>): SceneEdge[] {
  const out = new Set<SceneEdge>();
  const visit = (node: SceneNode): void => {
    for (const edge of [...node.incoming, ...node.outgoing]) out.add(edge);
    for (const child of node.children) if (child.kind === 'node') visit(child);
  };
  for (const element of elements) {
    if (element.kind === 'edge') out.add(element);
    else if (element.kind === 'node') visit(element);
  }
  return [...out];
}

export function nodesOf(scene: Scene): SceneNode[] {
  const out: SceneNode[] = [];
  for (const element of scene.elementsById.values()) if (element.kind === 'node') out.push(element);
  return out;
}

export function edgesOf(scene: Scene): SceneEdge[] {
  const out: SceneEdge[] = [];
  for (const element of scene.elementsById.values()) if (element.kind === 'edge') out.push(element);
  return out;
}

/** Nodes and edges (no labels), in scene order. */
export function drawablesOf(scene: Scene): (SceneNode | SceneEdge)[] {
  const out: (SceneNode | SceneEdge)[] = [];
  for (const element of scene.elementsById.values()) {
    if (element.kind !== 'label') out.push(element);
  }
  return out;
}

/** The box enclosing every node footprint and edge waypoint of `elements`. */
export function boundsOf(elements: Iterable<SceneElement>): Bounds | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const el of elements) {
    if (el.kind === 'edge') {
      for (const p of el.waypoints) grow(p.x, p.y);
    } else {
      grow(el.x, el.y);
      grow(el.x + el.width, el.y + el.height);
    }
  }
  if (!Number.isFinite(minX)) return undefined;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
