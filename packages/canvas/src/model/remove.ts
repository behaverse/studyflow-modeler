/**
 * Deletion: the closure of what cannot survive the removed elements (contents,
 * attached boundary events, incident edges), unwired from every reference in the
 * moddle tree and dropped from the scene.
 */

import type { EventBus } from '@core/events/bus.ts';
import { activityOf, isDataAssociationType, pruneDataAssociation } from '@canvas/model/dataAssociation.ts';
import { dropLabel } from '@canvas/model/labels.ts';
import {
  asModdle,
  clearParent,
  clearRef,
  parentOf,
  prop,
  pullFrom,
  refBOs,
  setProp,
  unfile,
} from '@canvas/model/moddle.ts';
import type { ModdleObject, Scene, SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import { depthOf } from '@canvas/model/tree.ts';

type Drawable = SceneNode | SceneEdge;

function attachedIndex(scene: Scene): Map<ModdleObject, SceneNode[]> {
  const index = new Map<ModdleObject, SceneNode[]>();
  for (const element of scene.elementsById.values()) {
    if (element.kind !== 'node') continue;
    const host = asModdle(prop(element.businessObject, 'attachedToRef'));
    if (!host) continue;
    index.set(host, [...(index.get(host) ?? []), element]);
  }
  return index;
}

function laneNodes(scene: Scene): SceneNode[] {
  const lanes: SceneNode[] = [];
  for (const element of scene.elementsById.values()) {
    if (element.kind === 'node' && element.type === 'bpmn:Lane') lanes.push(element);
  }
  return lanes;
}

/** Edges referencing a CONNECTION as an end (an association off a sequence flow). */
function danglingRefIndex(scene: Scene): Map<ModdleObject, SceneEdge[]> {
  const index = new Map<ModdleObject, SceneEdge[]>();
  for (const element of scene.elementsById.values()) {
    if (element.kind !== 'edge') continue;
    for (const end of ['sourceRef', 'targetRef'] as const) {
      for (const ref of refBOs(prop(element.businessObject, end))) {
        if (scene.byBusinessObject.get(ref)?.kind !== 'edge') continue;
        index.set(ref, [...(index.get(ref) ?? []), element]);
      }
    }
  }
  return index;
}

/** The transitive closure of a deletion. */
export function collectRemoval(scene: Scene, seeds: readonly SceneElement[]): Drawable[] {
  const attached = attachedIndex(scene);
  const referencing = danglingRefIndex(scene);
  const out: Drawable[] = [];
  const seen = new Set<Drawable>();
  const visit = (element: Drawable): void => {
    if (seen.has(element)) return;
    seen.add(element);
    out.push(element);
    for (const edge of referencing.get(element.businessObject) ?? []) visit(edge);
    if (element.kind === 'edge') return;
    for (const child of element.children.slice()) if (child.kind !== 'label') visit(child);
    for (const edge of [...element.incoming, ...element.outgoing]) visit(edge);
    for (const boundary of attached.get(element.businessObject) ?? []) visit(boundary);
  };
  for (const seed of seeds) if (seed.kind !== 'label') visit(seed);
  return out;
}

export interface DeleteResult {
  removed: Drawable[];
  /** Survivors whose references or children changed. */
  changed: Drawable[];
}

export function deleteElements(
  scene: Scene,
  bus: EventBus,
  elements: readonly SceneElement[],
): DeleteResult {
  const removed = collectRemoval(scene, elements);
  if (removed.length === 0) return { removed: [], changed: [] };

  const removedSet = new Set<SceneElement>(removed);
  const changed = new Set<Drawable>();
  const lanes = laneNodes(scene);

  // Edges first (they only reference), then nodes deepest-first.
  const edges = removed.filter((el): el is SceneEdge => el.kind === 'edge');
  const nodes = removed
    .filter((el): el is SceneNode => el.kind === 'node')
    .sort((a, b) => depthOf(b) - depthOf(a));
  for (const edge of edges) detachEdge(edge, removedSet, changed);
  for (const node of nodes) detachNode(node, scene, lanes, removedSet, changed);

  for (const element of removed) {
    dropLabel(scene, element);
    if (scene.elementsById.get(element.id) === element) scene.elementsById.delete(element.id);
    if (scene.byBusinessObject.get(element.businessObject) === element) {
      scene.byBusinessObject.delete(element.businessObject);
    }
  }
  const parents = new Set<SceneNode>();
  for (const element of removed) {
    if (element.parent && !removedSet.has(element.parent)) parents.add(element.parent);
    element.parent = undefined;
  }
  for (const parent of parents) {
    parent.children = parent.children.filter((child) => !removedSet.has(child));
    changed.add(parent);
  }
  scene.children = scene.children.filter((child) => !removedSet.has(child));
  scene.rootElement.children = scene.children;

  for (const element of removed) changed.delete(element);
  const changedList = [...changed];
  scene.revision += 1;
  bus.fire('ElementsRemoved', { elements: removed.slice() });
  for (const element of changedList) bus.fire('ElementChanged', { element });
  bus.fire('ElementsChanged', { elements: [...removed, ...changedList] });
  return { removed, changed: changedList };
}

function detachEdge(edge: SceneEdge, removedSet: Set<SceneElement>, changed: Set<Drawable>): void {
  const bo = edge.businessObject;
  const sourceBOs = [...(edge.source ? [edge.source.businessObject] : []), ...refBOs(prop(bo, 'sourceRef'))];
  const targetBOs = [...(edge.target ? [edge.target.businessObject] : []), ...refBOs(prop(bo, 'targetRef'))];

  if (isDataAssociationType(edge.type)) pruneDataAssociation(bo, activityOf(bo));
  for (const end of sourceBOs) {
    pullFrom(end, 'outgoing', bo);
    if (prop(end, 'default') === bo) setProp(end, 'default', undefined);
  }
  for (const end of targetBOs) pullFrom(end, 'incoming', bo);
  clearRef(bo, 'sourceRef');
  clearRef(bo, 'targetRef');
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

function detachNode(
  node: SceneNode,
  scene: Scene,
  lanes: readonly SceneNode[],
  removedSet: Set<SceneElement>,
  changed: Set<Drawable>,
): void {
  const bo = node.businessObject;
  for (const lane of lanes) {
    if (lane !== node && pullFrom(lane.businessObject, 'flowNodeRef', bo) && !removedSet.has(lane)) {
      changed.add(lane);
    }
  }
  if (node.type === 'bpmn:Participant') releaseProcessRef(node, scene, removedSet);
  const owner = parentOf(bo);
  unfile(bo, [owner]);
  // An emptied lane set is meaningless on its own.
  if (owner?.$type === 'bpmn:LaneSet') {
    const remaining = prop(owner, 'lanes');
    if (!Array.isArray(remaining) || remaining.length === 0) unfile(owner, [parentOf(owner)]);
  }
}

/** Drop the `bpmn:Process` a deleted pool depicted, unless something still needs it. */
function releaseProcessRef(node: SceneNode, scene: Scene, removedSet: Set<SceneElement>): void {
  const processRef = asModdle(prop(node.businessObject, 'processRef'));
  if (!processRef) return;
  for (const element of scene.elementsById.values()) {
    if (element === node || element.kind !== 'node' || removedSet.has(element)) continue;
    if (asModdle(prop(element.businessObject, 'processRef')) === processRef) return;
  }
  if (scene.root === processRef) return;
  pullFrom(scene.definitions, 'rootElements', processRef);
  clearParent(processRef);
}
