/**
 * Deletion writeback — remove elements from BOTH halves of the live document
 * (design §1 "delete → remove BO from its container **and** its `planeElement`",
 * §6 P5 "serialization-writeback completeness").
 *
 * Deleting is the one edit where "write through to the live moddle tree" is not
 * enough on its own: a business object is reachable from more places than the
 * container it is filed in. A sequence flow is listed in `flowElements` *and* in
 * both endpoints' `outgoing`/`incoming`; a flow node may be claimed by a lane's
 * `flowNodeRef`; a pool points at a `bpmn:Process` root element; an expanded
 * sub-process may own a whole extra `bpmndi:BPMNDiagram`. Leave any one of those
 * behind and `bpmn-moddle`'s `toXML` emits a dangling `sourceRef`, an orphan
 * `BPMNShape`, or an unreachable root element — which is exactly what P5 must not
 * do.
 *
 * So {@link deleteElements} works on the *closure* of what the user asked to
 * delete ({@link collectRemoval}): descendants, nested-plane contents, attached
 * boundary events, and every incident edge. It then unwires each element from
 * every reference that can reach it, drops the DI, prunes the scene indexes, bumps
 * {@link Scene.revision} and fires. Nothing is rebuilt — the very objects
 * `model/import.ts` referenced are mutated in place, as everywhere else in the
 * canvas.
 */

import type { EventBus } from '@canvas/events/bus.ts';
import {
  activityOf,
  isDataAssociationType,
  pruneDataAssociation,
} from '@canvas/model/dataAssociation.ts';
import {
  asModdle,
  clearParent,
  clearRef,
  definitionsAbove,
  parentOf,
  prop,
  pullFrom,
  refBOs,
  setProp,
  unfile,
} from '@canvas/model/moddle.ts';
import type {
  ModdleObject,
  Plane,
  Scene,
  SceneEdge,
  SceneElement,
  SceneNode,
} from '@canvas/model/scene.ts';

/** The `bpmn:Definitions` root reachable from a scene's root plane, if any. */
function definitionsOfScene(scene: Scene): ModdleObject | undefined {
  return definitionsAbove(scene.rootPlane.di);
}

// --- removal closure ---------------------------------------------------------

/** How deeply a node is nested (used to delete children before their container). */
function depthOf(element: SceneElement): number {
  let depth = 0;
  let cursor = element.parent;
  const guard = new Set<SceneNode>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    depth += 1;
    cursor = cursor.parent;
  }
  return depth;
}

/** Index of host business object → the boundary events attached to it. */
function attachedIndex(scene: Scene): Map<ModdleObject, SceneNode[]> {
  const index = new Map<ModdleObject, SceneNode[]>();
  for (const element of scene.elementsById.values()) {
    if (element.kind !== 'node') continue;
    const host = asModdle(prop(element.businessObject, 'attachedToRef'));
    if (!host) continue;
    const list = index.get(host);
    if (list) list.push(element);
    else index.set(host, [element]);
  }
  return index;
}

/** Index of root business object → the NESTED plane that depicts it (never the root plane). */
function nestedPlaneIndex(scene: Scene): Map<ModdleObject, Plane[]> {
  const index = new Map<ModdleObject, Plane[]>();
  for (const plane of scene.planes) {
    if (plane === scene.rootPlane) continue;
    const list = index.get(plane.businessObject);
    if (list) list.push(plane);
    else index.set(plane.businessObject, [plane]);
  }
  return index;
}

/** Every `bpmn:Lane` node in the scene (they claim members by reference, not containment). */
function laneNodes(scene: Scene): SceneNode[] {
  const lanes: SceneNode[] = [];
  for (const element of scene.elementsById.values()) {
    if (element.kind === 'node' && element.type === 'bpmn:Lane') lanes.push(element);
  }
  return lanes;
}

/** The nested planes that depict `node` (its own BO, or the process a pool points at). */
function nestedPlanesOf(node: SceneNode, index: Map<ModdleObject, Plane[]>): Plane[] {
  const planes = [...(index.get(node.businessObject) ?? [])];
  const processRef = asModdle(prop(node.businessObject, 'processRef'));
  if (processRef) for (const plane of index.get(processRef) ?? []) planes.push(plane);
  return planes;
}

/**
 * Index of business object → the edges that REFERENCE it as an endpoint but do not
 * link to it in the scene.
 *
 * There is one such edge: a `bpmn:Association` reaching a text annotation that
 * hangs off a CONNECTION (ux-spec §4 — the annotate entry a selected sequence flow
 * offers). `SceneEdge.source` is a node, so neither the import nor
 * {@link Writeback.addConnection} can record that end in the scene, and the flow's
 * own `outgoing` list — a node's list — never holds it either. Without this index a
 * deleted flow would leave the association behind with a `sourceRef` pointing at a
 * business object that is no longer in the document, which `toXML` then emits.
 */
function danglingRefIndex(scene: Scene): Map<ModdleObject, SceneEdge[]> {
  const index = new Map<ModdleObject, SceneEdge[]>();
  for (const element of scene.elementsById.values()) {
    if (element.kind !== 'edge') continue;
    for (const end of ['sourceRef', 'targetRef'] as const) {
      for (const ref of refBOs(prop(element.businessObject, end))) {
        // Only the ends the scene could NOT link: a shape end is already reachable
        // through `incoming`/`outgoing`, and listing it twice is just work.
        if (scene.byBusinessObject.get(ref)?.kind !== 'edge') continue;
        const list = index.get(ref);
        if (list) list.push(element);
        else index.set(ref, [element]);
      }
    }
  }
  return index;
}

/**
 * The transitive closure of a deletion: the seeds plus everything that cannot
 * survive them — a container's descendants and the contents of its nested plane,
 * the boundary events attached to a deleted activity, every edge incident to a
 * deleted node (which in turn may be a data association whose other end stays), and
 * the association a deleted CONNECTION carries ({@link danglingRefIndex}).
 *
 * Exported so a caller can preview what a delete would take with it (and so the
 * spec can assert the closure directly).
 */
export function collectRemoval(
  scene: Scene,
  seeds: readonly SceneElement[],
): SceneElement[] {
  const attached = attachedIndex(scene);
  const nested = nestedPlaneIndex(scene);
  const referencing = danglingRefIndex(scene);
  const out: SceneElement[] = [];
  const seen = new Set<SceneElement>();

  const visit = (element: SceneElement): void => {
    if (seen.has(element)) return;
    seen.add(element);
    out.push(element);
    for (const edge of referencing.get(element.businessObject) ?? []) visit(edge);
    if (element.kind === 'edge') return;
    for (const child of element.children.slice()) visit(child);
    for (const edge of [...element.incoming, ...element.outgoing]) visit(edge);
    for (const boundary of attached.get(element.businessObject) ?? []) visit(boundary);
    for (const plane of nestedPlanesOf(element, nested)) {
      for (const child of plane.children.slice()) visit(child);
    }
  };

  for (const seed of seeds) visit(seed);
  return out;
}

// --- the delete ---------------------------------------------------------------

/** What {@link deleteElements} removed, and which survivors it had to touch. */
export interface DeleteResult {
  /** Every element actually removed (the closure of the request). */
  removed: SceneElement[];
  /** Surviving elements whose references/children changed (endpoints, containers, lanes). */
  changed: SceneElement[];
}

/** Payload for the `elements.removed` event. */
export interface ElementsRemovedEvent {
  elements: SceneElement[];
}

/**
 * Delete `elements` (and everything that cannot survive them) from the live moddle
 * tree, its DI, and the scene.
 *
 * For every removed **edge**: the business object leaves its container, both
 * endpoints' `outgoing`/`incoming` reference lists lose it, a gateway's `default`
 * that pointed at it is cleared, its own `sourceRef`/`targetRef` are cleared, and
 * its `bpmndi:BPMNEdge` leaves the plane.
 *
 * For every removed **node**: the business object leaves `flowElements` /
 * `artifacts` / `participants` / `lanes`, every lane's `flowNodeRef` drops it, a
 * pool's now-unreferenced `bpmn:Process` leaves `rootElements`, an emptied
 * `bpmn:LaneSet` leaves its owner, the nested `bpmndi:BPMNDiagram` a container
 * owned leaves `definitions.diagrams`, and its `bpmndi:BPMNShape` leaves the plane.
 *
 * Bumps the revision once for the whole batch and fires `elements.removed`,
 * `element.changed` per touched survivor, and `elements.changed`.
 */
export function deleteElements(
  scene: Scene,
  bus: EventBus,
  elements: SceneElement | readonly SceneElement[],
): DeleteResult {
  const seeds = Array.isArray(elements)
    ? (elements as readonly SceneElement[])
    : [elements as SceneElement];
  const removed = collectRemoval(scene, seeds);
  if (removed.length === 0) return { removed: [], changed: [] };

  const removedSet = new Set<SceneElement>(removed);
  const changed = new Set<SceneElement>();
  const definitions = definitionsOfScene(scene);
  const lanes = laneNodes(scene);
  const nested = nestedPlaneIndex(scene);
  // Snapshot: a nested plane is unlisted from the scene below, but its own
  // `planeElement` list still has to give up the DI of everything it depicted.
  const planes = scene.planes.slice();

  // Edges first (they only reference), then nodes deepest-first so a child is
  // unfiled from its container before the container itself goes.
  const edges = removed.filter((el): el is SceneEdge => el.kind === 'edge');
  const nodes = removed
    .filter((el): el is SceneNode => el.kind === 'node')
    .sort((a, b) => depthOf(b) - depthOf(a));

  for (const edge of edges) detachEdge(edge, removedSet, changed);
  for (const node of nodes) {
    detachNode(node, scene, definitions, lanes, nested, removedSet, changed);
  }

  // DI + scene indexes, for both kinds alike.
  for (const element of removed) {
    removeDi(planes, element.di);
    if (element.id && scene.elementsById.get(element.id) === element) {
      scene.elementsById.delete(element.id);
    }
    if (scene.byBusinessObject.get(element.businessObject) === element) {
      scene.byBusinessObject.delete(element.businessObject);
    }
    const label = element.label;
    if (label?.id && scene.elementsById.get(label.id) === label) scene.elementsById.delete(label.id);
  }

  // Containment arrays: one pass per touched parent / plane rather than a splice
  // per element.
  const parents = new Set<SceneNode>();
  for (const element of removed) {
    const parent = element.parent;
    if (parent && !removedSet.has(parent)) parents.add(parent);
    element.parent = undefined;
  }
  for (const parent of parents) {
    parent.children = parent.children.filter((child) => !removedSet.has(child));
    changed.add(parent);
  }
  for (const plane of scene.planes) {
    if (plane.children.some((child) => removedSet.has(child))) {
      plane.children = plane.children.filter((child) => !removedSet.has(child));
    }
  }

  for (const element of removed) changed.delete(element);
  const changedList = [...changed];

  scene.revision += 1;
  bus.fire<ElementsRemovedEvent>('elements.removed', { elements: removed.slice() });
  for (const element of changedList) bus.fire('element.changed', { element });
  bus.fire('elements.changed', { elements: [...removed, ...changedList] });

  return { removed, changed: changedList };
}

/** Unwire one edge from its endpoints, its container, and the scene's endpoint lists. */
function detachEdge(
  edge: SceneEdge,
  removedSet: Set<SceneElement>,
  changed: Set<SceneElement>,
): void {
  const bo = edge.businessObject;
  const sourceBOs = [
    ...(edge.source ? [edge.source.businessObject] : []),
    ...refBOs(prop(bo, 'sourceRef')),
  ];
  const targetBOs = [
    ...(edge.target ? [edge.target.businessObject] : []),
    ...refBOs(prop(bo, 'targetRef')),
  ];

  // A data association may own a `bpmn:DataInput`/`DataOutput` slot inside the
  // activity's `ioSpecification`; give it back BEFORE the refs that reach it are
  // cleared, or the slot would outlive the association that declared it.
  if (isDataAssociationType(edge.type)) pruneDataAssociation(bo, activityOf(bo));

  for (const end of sourceBOs) {
    pullFrom(end, 'outgoing', bo);
    // A gateway/activity whose default flow was this edge must not keep pointing at it.
    if (prop(end, 'default') === bo) setProp(end, 'default', undefined);
  }
  for (const end of targetBOs) pullFrom(end, 'incoming', bo);

  clearRef(bo, 'sourceRef');
  clearRef(bo, 'targetRef');
  // The flow lives in its container's `flowElements`/`artifacts`, a collaboration's
  // `messageFlows`, or — for a data association — on the activity itself.
  unfile(bo, [parentOf(bo), ...sourceBOs, ...targetBOs]);

  if (edge.source && !removedSet.has(edge.source)) {
    edge.source.outgoing = edge.source.outgoing.filter((e) => e !== edge);
    changed.add(edge.source);
  }
  if (edge.target && !removedSet.has(edge.target)) {
    edge.target.incoming = edge.target.incoming.filter((e) => e !== edge);
    changed.add(edge.target);
  }
  edge.source = undefined;
  edge.target = undefined;
}

/** Unwire one node from its container, the lanes claiming it, and its nested plane. */
function detachNode(
  node: SceneNode,
  scene: Scene,
  definitions: ModdleObject | undefined,
  lanes: readonly SceneNode[],
  nested: Map<ModdleObject, Plane[]>,
  removedSet: Set<SceneElement>,
  changed: Set<SceneElement>,
): void {
  const bo = node.businessObject;

  // A lane owns its members by reference, so containment removal never reaches it.
  for (const lane of lanes) {
    if (lane === node) continue;
    if (pullFrom(lane.businessObject, 'flowNodeRef', bo) && !removedSet.has(lane)) {
      changed.add(lane);
    }
  }

  // A pool depicts a process; with the pool gone (and nothing else pointing at it)
  // that process would be an unreachable root element.
  if (node.type === 'bpmn:Participant') releaseProcessRef(node, scene, definitions, removedSet);

  const owner = parentOf(bo);
  unfile(bo, [owner]);

  // An emptied `bpmn:LaneSet` is meaningless on its own.
  if (owner?.$type === 'bpmn:LaneSet') {
    const remaining = prop(owner, 'lanes');
    if (!Array.isArray(remaining) || remaining.length === 0) unfile(owner, [parentOf(owner)]);
  }

  // The extra `bpmndi:BPMNDiagram` an expanded sub-process / drilled-down pool owned.
  for (const plane of nestedPlanesOf(node, nested)) removePlane(scene, definitions, plane);
}

/** Drop the `bpmn:Process` a deleted pool depicted, unless something still needs it. */
function releaseProcessRef(
  node: SceneNode,
  scene: Scene,
  definitions: ModdleObject | undefined,
  removedSet: Set<SceneElement>,
): void {
  const processRef = asModdle(prop(node.businessObject, 'processRef'));
  if (!processRef || !definitions) return;
  for (const element of scene.elementsById.values()) {
    if (element === node || element.kind !== 'node') continue;
    if (removedSet.has(element)) continue;
    if (asModdle(prop(element.businessObject, 'processRef')) === processRef) return;
  }
  // A plane still depicting it (the root plane of a drilled-down document) keeps it.
  for (const plane of scene.planes) {
    if (plane.businessObject === processRef && plane === scene.rootPlane) return;
  }
  pullFrom(definitions, 'rootElements', processRef);
  clearParent(processRef);
}

/** Remove a nested plane: its `bpmndi:BPMNDiagram` from the document, itself from the scene. */
function removePlane(scene: Scene, definitions: ModdleObject | undefined, plane: Plane): void {
  if (plane === scene.rootPlane) return;
  const diagram = parentOf(plane.di);
  if (definitions) {
    if (diagram) pullFrom(definitions, 'diagrams', diagram);
    else pullFrom(definitions, 'diagrams', plane.di);
  }
  scene.planes = scene.planes.filter((candidate) => candidate !== plane);
}

/** Remove a `bpmndi:BPMNShape`/`BPMNEdge` from whichever plane holds it. */
function removeDi(planes: readonly Plane[], di: ModdleObject | undefined): void {
  if (!di) return;
  const owner = parentOf(di);
  if (!(owner && pullFrom(owner, 'planeElement', di))) {
    for (const plane of planes) {
      if (pullFrom(plane.di, 'planeElement', di)) break;
    }
  }
  clearParent(di);
}
