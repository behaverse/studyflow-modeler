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
 * Deliberately out of scope (design §1 keeps the DI where the document put it): a
 * toggle does not migrate a nested plane's `planeElement` entries into the parent
 * plane, nor re-base their coordinates. Expanding reveals the children where their
 * own DI puts them; collapsing hides them again. A no-op collapse+expand therefore
 * round-trips to a structurally identical document.
 *
 * This module is pure: it mutates the scene node and its DI and reports what the
 * caller must apply/redraw. Revision bumps and bus events belong to
 * {@link Writeback} (`model/writeback.ts`), which owns both.
 */

import type {
  Bounds,
  Plane,
  Scene,
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
