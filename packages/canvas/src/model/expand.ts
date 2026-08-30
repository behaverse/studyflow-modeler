/**
 * Expand / collapse writeback — the DI *flag* half of P5 (design §1
 * "expand/collapse subprocess → `BPMNShape.isExpanded` (+ reveal/hide nested plane)"
 * and "gateway marker → `BPMNShape.isMarkerVisible`", §6 P5).
 *
 * Two boolean attributes on a `bpmndi:BPMNShape` carry state that no business
 * object holds: `isExpanded` (a sub-process drawn as a frame around its contents,
 * or task-sized with a ⊞ marker) and `isMarkerVisible` (the × inside an exclusive
 * gateway). Both are pure DI, so toggling them is a write-through edit exactly like
 * a move: mutate the live moddle object the scene was imported from and
 * `bpmn-moddle` re-emits the attribute — nothing is rebuilt.
 *
 * Collapsing additionally changes what is *drawn*. The elements a sub-process
 * contains keep existing — in `flowElements` and in whatever plane their DI lives
 * in (design §1 "Nested planes": a drilled-down sub-process owns an extra
 * `bpmndi:BPMNDiagram`, an inline-expanded one draws its children in the parent
 * plane) — they are simply not shown while their container is collapsed. That is
 * the whole visibility model: {@link isHiddenByCollapse} is derived from the scene
 * tree on every draw (`render/renderer.ts`) and consulted by hit-testing
 * (`interaction/hit.ts`), so there is no second source of truth to keep in sync and
 * a collapse **never** touches a descendant's document state.
 *
 * A nested plane is the one case where revealing is not enough. Its contents live in
 * their OWN coordinate space (`sklearn_pipeline`'s `select_model` sits at 1204,230
 * while its `build_pipeline` child sits at 256,160), so simply un-hiding them draws
 * the interior a thousand units away from the frame that is supposed to contain it.
 * Expanding such a container therefore INLINES the plane —
 * `model/writeback.ts inlineNestedPlane` re-bases the contents rigidly into the new
 * frame and moves their `planeElement` entries up into the parent plane, exactly the
 * shape an inline-expanded sub-process already has — and collapsing puts the plane
 * back, verbatim, from a parked snapshot. A no-op collapse+expand (either way round)
 * therefore still round-trips to a byte-identical document.
 *
 * This module is pure: it mutates the scene node and its DI and reports what the
 * caller must apply/redraw. Revision bumps and bus events belong to
 * {@link Writeback} (`model/writeback.ts`), which owns both.
 */

import type {
  Bounds,
  Plane,
  Point,
  Scene,
  SceneEdge,
  SceneElement,
  SceneNode,
} from '@canvas/model/scene.ts';
import { asModdle, prop, setProp } from '@canvas/model/moddle.ts';

// --- the expandable vocabulary ------------------------------------------------

/**
 * The activity types whose `BPMNShape` carries a meaningful `isExpanded` — the
 * sub-process family plus the choreography containers that own a sub-plane
 * (design §2). A `bpmn:Participant` is excluded on purpose: a "collapsed" pool is a
 * black box with no contents to reveal, and making it toggle would steal the
 * double-click that renames it.
 */
export const EXPANDABLE_TYPES: ReadonlySet<string> = new Set([
  'bpmn:SubProcess',
  'bpmn:AdHocSubProcess',
  'bpmn:Transaction',
  'bpmn:SubChoreography',
  'bpmn:CallChoreography',
]);

/** Whether a BPMN type can be expanded/collapsed ({@link EXPANDABLE_TYPES}). */
export function isExpandable(type: string): boolean {
  return EXPANDABLE_TYPES.has(type);
}

/**
 * Whether `node` is an expandable container currently drawn collapsed. Only an
 * explicit `isExpanded === false` counts: a `BPMNShape` that omits the attribute is
 * treated as expanded, which is how `model/import.ts` reads it and how
 * `render/renderer.ts` and `interaction/hit.ts` have always drawn it.
 */
export function isCollapsed(node: SceneNode): boolean {
  return node.isExpanded === false && isExpandable(node.type);
}

/** Whether `node` is an expandable container currently drawn expanded. */
export function isExpanded(node: SceneNode): boolean {
  return node.isExpanded !== false && isExpandable(node.type);
}

/**
 * Whether `element` sits inside a collapsed container and must therefore not be
 * drawn or hit-tested. Derived from the scene's parent chain on every use — the
 * containment `model/import.ts` builds already splices a nested plane's contents
 * under the sub-process that owns the plane, so this covers both the inline-expanded
 * and the drilled-down layout.
 */
export function isHiddenByCollapse(element: SceneElement): boolean {
  let cursor = element.parent;
  const guard = new Set<SceneNode>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    if (isCollapsed(cursor)) return true;
    cursor = cursor.parent;
  }
  return false;
}

/**
 * Every nested plane that depicts `node` (never the root plane).
 *
 * A plane may depict the node's own business object (a sub-process) **or** the
 * `bpmn:Process` a pool points at through `processRef` — a drilled-down pool's
 * `BPMNPlane.bpmnElement` is the process, not the participant. Both count, which is
 * what lets a drill-down (`view/plane.ts` `nestedPlaneOf`) and a delete
 * (`model/remove.ts`) find the same plane for the same node.
 */
export function nestedPlanesOf(scene: Scene, node: SceneNode): Plane[] {
  const processRef = asModdle(prop(node.businessObject, 'processRef'));
  return scene.planes.filter(
    (plane) => plane !== scene.rootPlane
      && (plane.businessObject === node.businessObject
        || (processRef !== undefined && plane.businessObject === processRef)),
  );
}

/**
 * Every element whose visibility follows `node` — its descendants in the scene tree
 * (which includes the contents of any nested plane it owns) plus, defensively, any
 * plane child the tree missed. Depth-first, containers before their contents.
 */
export function contentsOf(scene: Scene, node: SceneNode): SceneElement[] {
  const out: SceneElement[] = [];
  const seen = new Set<SceneElement>([node]);

  const visit = (element: SceneElement): void => {
    if (seen.has(element)) return;
    seen.add(element);
    out.push(element);
    if (element.kind === 'node') for (const child of element.children) visit(child);
  };

  for (const child of node.children) visit(child);
  for (const plane of nestedPlanesOf(scene, node)) for (const child of plane.children) visit(child);
  return out;
}

// --- geometry -----------------------------------------------------------------

/** Footprint a collapsed sub-process takes — the plain activity box (design §2). */
export const COLLAPSED_SUBPROCESS_SIZE = { width: 100, height: 80 } as const;

/**
 * Footprint an expanded sub-process takes when nothing better is known — it has to
 * hold something. (`interaction/create.ts` re-exports this as the size a palette
 * drop of an expanded sub-process gets, so both paths agree.)
 */
export const EXPANDED_SUBPROCESS_SIZE = { width: 350, height: 200 } as const;

/**
 * Inset of a nested plane's contents inside the frame that reveals them. The top is
 * the deepest side, leaving the band a BPMN frame conventionally reserves for the
 * container's own name clear of the first row of children.
 */
export const EXPANDED_CONTENT_PADDING = { top: 40, right: 30, bottom: 30, left: 30 } as const;

/**
 * The frame that holds `contents` when a container is expanded around them: the
 * contents' bounding box grown by {@link EXPANDED_CONTENT_PADDING}, never smaller
 * than {@link EXPANDED_SUBPROCESS_SIZE}, anchored at `origin` — the toggle keeps the
 * shape's top-left corner and grows right and down, as every resize on this path does.
 */
export function frameAround(origin: Point, contents: Bounds): Bounds {
  const pad = EXPANDED_CONTENT_PADDING;
  return {
    x: origin.x,
    y: origin.y,
    width: Math.max(EXPANDED_SUBPROCESS_SIZE.width, contents.width + pad.left + pad.right),
    height: Math.max(EXPANDED_SUBPROCESS_SIZE.height, contents.height + pad.top + pad.bottom),
  };
}

/**
 * The footprint a node had the last time it was expanded, remembered per DI object
 * so a collapse→expand round-trip restores the exact `dc:Bounds` the document came
 * in with (and therefore serializes byte-identically). Keyed weakly: nothing here
 * keeps a scene or a document alive, and a re-import simply starts with no memory.
 */
const expandedFootprint = new WeakMap<object, { width: number; height: number }>();

/** The memory key for a node — its DI shape when it has one, else the node itself. */
function footprintKey(node: SceneNode): object {
  return node.di ?? node;
}

/** Remember `node`'s current footprint as its expanded one (exported for tests/tools). */
export function rememberExpandedFootprint(node: SceneNode): void {
  expandedFootprint.set(footprintKey(node), { width: node.width, height: node.height });
}

/** The remembered expanded footprint of `node`, if a collapse recorded one. */
export function expandedFootprintOf(node: SceneNode): { width: number; height: number } | undefined {
  return expandedFootprint.get(footprintKey(node));
}

// --- incident-edge routing memory ----------------------------------------------

/** Every edge docked to `node`, each listed once (a self-loop is both ends). */
export function incidentEdgesOf(node: SceneNode): SceneEdge[] {
  const out: SceneEdge[] = [];
  for (const edge of node.outgoing) if (!out.includes(edge)) out.push(edge);
  for (const edge of node.incoming) if (!out.includes(edge)) out.push(edge);
  return out;
}

/** How the edges docked to a node were routed while it wore a given footprint. */
interface IncidentRouting {
  bounds: Bounds;
  waypoints: Map<SceneEdge, Point[]>;
}

/**
 * The incident routing a node had in each of its two states, remembered per DI
 * object beside {@link expandedFootprint}.
 *
 * A toggle re-docks and re-routes every incident edge against the new outline
 * (`model/writeback.ts redockToOutline`), and a *computed* route is not the route the
 * document shipped: without this, collapsing and re-expanding a sub-process would
 * leave the diagram subtly re-cut and the serialization no longer byte-identical.
 * So the routing is parked on the way out of a state and put back verbatim on the
 * way in — but only when the footprint being returned to is EXACTLY the one that was
 * parked with it, so a resize or a move in between falls through to a fresh route.
 */
const incidentRouting = new WeakMap<object, Map<boolean, IncidentRouting>>();

/** Whether two waypoint lists describe the same path. */
export function samePoints(a: readonly Point[], b: readonly Point[]): boolean {
  return a.length === b.length
    && a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-6 && Math.abs(p.y - b[i].y) < 1e-6);
}

/** Park `node`'s current incident routing under the state it is in RIGHT NOW. */
export function rememberIncidentRouting(node: SceneNode): void {
  const key = footprintKey(node);
  let byState = incidentRouting.get(key);
  if (!byState) {
    byState = new Map<boolean, IncidentRouting>();
    incidentRouting.set(key, byState);
  }
  const waypoints = new Map<SceneEdge, Point[]>();
  for (const edge of incidentEdgesOf(node)) {
    waypoints.set(edge, edge.waypoints.map((p) => ({ x: p.x, y: p.y })));
  }
  byState.set(node.isExpanded !== false, {
    bounds: { x: node.x, y: node.y, width: node.width, height: node.height },
    waypoints,
  });
}

/**
 * Put back the routing parked for the state `node` is in now, when the footprint
 * matches and the incident set is unchanged. Returns the edges actually moved, or
 * `undefined` when there is nothing trustworthy to restore and the caller must
 * re-dock from scratch.
 */
export function restoreIncidentRouting(node: SceneNode): SceneEdge[] | undefined {
  const memory = incidentRouting.get(footprintKey(node))?.get(node.isExpanded !== false);
  if (!memory) return undefined;
  const box = memory.bounds;
  if (box.x !== node.x || box.y !== node.y || box.width !== node.width || box.height !== node.height) {
    return undefined;
  }
  const edges = incidentEdgesOf(node);
  // An edge added or deleted since the snapshot makes it stale wholesale — nothing
  // is written until the whole set is known good.
  if (edges.length !== memory.waypoints.size) return undefined;
  for (const edge of edges) if (!memory.waypoints.has(edge)) return undefined;

  const restored: SceneEdge[] = [];
  for (const edge of edges) {
    const points = memory.waypoints.get(edge) as Point[];
    if (samePoints(edge.waypoints, points)) continue;
    edge.waypoints = points.map((p) => ({ x: p.x, y: p.y }));
    restored.push(edge);
  }
  return restored;
}

// --- the toggle ----------------------------------------------------------------

/** Options for {@link applyExpanded}. */
export interface SetExpandedOptions {
  /**
   * Resize the shape to match its new state — a collapsed sub-process shrinks to the
   * plain activity box, an expanded one grows back to the footprint it had before
   * (or {@link EXPANDED_SUBPROCESS_SIZE} when nothing was remembered). The top-left
   * corner stays put. Default `true`; pass `false` to flip the flag only.
   */
  resize?: boolean;
  /** Explicit bounds to take instead of the computed ones (wins over `resize`). */
  bounds?: Bounds;
}

/** What {@link applyExpanded} decided; the caller applies the geometry and fires. */
export interface ExpandPlan {
  /** Whether anything was written (`false` for a non-expandable type or a no-op). */
  applied: boolean;
  /** The bounds the caller must write through, when the toggle resizes the shape. */
  bounds?: Bounds;
  /** Descendants whose visibility followed the toggle — they need a re-draw. */
  contents: SceneElement[];
}

/**
 * Flip `node`'s expanded state: write `BPMNShape.isExpanded` on the live DI object
 * and mirror it on the scene node, remember/restore the expanded footprint, and
 * report the descendants whose visibility just changed.
 *
 * The contents themselves are **not** touched — collapsing hides, it never deletes
 * (their business objects stay in `flowElements` and their DI stays in whatever
 * plane holds it), which is exactly what makes the toggle lossless.
 */
export function applyExpanded(
  scene: Scene,
  node: SceneNode,
  expanded: boolean,
  options: SetExpandedOptions = {},
): ExpandPlan {
  if (!isExpandable(node.type)) return { applied: false, contents: [] };

  const was = node.isExpanded;
  const flagChanged = was !== expanded;
  node.isExpanded = expanded;
  if (node.di) setProp(node.di, 'isExpanded', expanded);

  const bounds = plannedBounds(node, expanded, was, options);
  return {
    applied: flagChanged || bounds !== undefined,
    ...(bounds ? { bounds } : {}),
    contents: contentsOf(scene, node),
  };
}

/**
 * The footprint the toggled node should take, or `undefined` to leave it alone.
 *
 * Only a real open/close resizes: a shape that was already drawn expanded (its DI
 * omits `isExpanded`, which every reader here treats as expanded) keeps whatever
 * footprint the document gave it when the flag is merely written out.
 */
function plannedBounds(
  node: SceneNode,
  expanded: boolean,
  was: boolean | undefined,
  options: SetExpandedOptions,
): Bounds | undefined {
  if (options.bounds) return { ...options.bounds };
  if (options.resize === false) return undefined;
  const opened = expanded && was === false;
  const closed = !expanded && was !== false;
  if (!opened && !closed) return undefined;

  if (!expanded) {
    // Remember what to grow back to, then take the plain activity box.
    rememberExpandedFootprint(node);
    const size = COLLAPSED_SUBPROCESS_SIZE;
    if (node.width === size.width && node.height === size.height) return undefined;
    return { x: node.x, y: node.y, width: size.width, height: size.height };
  }

  const size = expandedFootprintOf(node) ?? EXPANDED_SUBPROCESS_SIZE;
  if (node.width === size.width && node.height === size.height) return undefined;
  return { x: node.x, y: node.y, width: size.width, height: size.height };
}

/**
 * Write `BPMNShape.isMarkerVisible` (the × of an exclusive gateway) on the live DI
 * object and mirror it on the scene node. Returns whether anything changed — a
 * no-op toggle leaves the document, and therefore its serialization, untouched.
 */
export function applyMarkerVisible(node: SceneNode, visible: boolean): boolean {
  const current = node.di ? prop(node.di, 'isMarkerVisible') : node.isMarkerVisible;
  if (node.isMarkerVisible === visible && current === visible) return false;
  node.isMarkerVisible = visible;
  if (node.di) setProp(node.di, 'isMarkerVisible', visible);
  return true;
}
