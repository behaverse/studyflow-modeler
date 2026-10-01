/**
 * Deletion: the closure of what cannot survive the removed elements (contents,
 * attached boundary events, incident edges), unwired from every reference in the
 * study model and dropped from the scene.
 */

import { isDataAssociationType } from '@core/element/index.ts';
import type { Element } from '@core/model/index.ts';

import { activityOf, pruneDataAssociation } from '@canvas/study/dataAssociation.ts';
import { dropRef, idsIn, listOf, refOf } from '@canvas/study/elements.ts';
import type { IdGenerator } from '@canvas/study/ids.ts';
import { dropLabel } from '@canvas/study/labels.ts';
import type { Drawable, Scene, SceneEdge, SceneElement, SceneNode } from '@canvas/study/scene.ts';
import { changeRoot } from '@canvas/study/root.ts';
import { depthOf } from '@canvas/study/tree.ts';


/** The boundary events on each activity, by its id. */
function attachedIndex(scene: Scene): Map<string, SceneNode[]> {
  const index = new Map<string, SceneNode[]>();
  for (const element of scene.elementsById.values()) {
    if (element.kind !== 'node') continue;
    const [host] = idsIn(element.element.attachedToRef);
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

/** Edges referencing a CONNECTION as an end (an association off a sequence flow), by that connection's id. */
function danglingRefIndex(scene: Scene): Map<string, SceneEdge[]> {
  const index = new Map<string, SceneEdge[]>();
  for (const element of scene.elementsById.values()) {
    if (element.kind !== 'edge') continue;
    for (const end of ['sourceRef', 'targetRef'] as const) {
      for (const id of idsIn(element.element[end])) {
        if (scene.elementsById.get(id)?.kind !== 'edge') continue;
        index.set(id, [...(index.get(id) ?? []), element]);
      }
    }
  }
  return index;
}

/** The transitive closure of a deletion. */
function collectRemoval(scene: Scene, seeds: readonly SceneElement[]): Drawable[] {
  const attached = attachedIndex(scene);
  const referencing = danglingRefIndex(scene);
  const out: Drawable[] = [];
  const seen = new Set<Drawable>();
  const visit = (element: Drawable): void => {
    if (seen.has(element)) return;
    seen.add(element);
    out.push(element);
    for (const edge of referencing.get(element.id) ?? []) visit(edge);
    if (element.kind === 'edge') return;
    for (const child of element.children.slice()) if (child.kind !== 'label') visit(child);
    for (const edge of [...element.incoming, ...element.outgoing]) visit(edge);
    for (const boundary of attached.get(element.id) ?? []) visit(boundary);
  };
  for (const seed of seeds) if (seed.kind !== 'label') visit(seed);
  return out;
}

export interface DeleteResult {
  removed: Drawable[];
  /** Survivors whose references or children changed. */
  changed: Drawable[];
  /** The last pool went, and the process is the root again. */
  rootChanged: boolean;
}

/** Remove `elements` and their closure from the scene and the study; the caller commits the result. */
export function deleteElements(scene: Scene, elements: readonly SceneElement[], ids: IdGenerator): DeleteResult {
  const removed = collectRemoval(scene, elements);
  if (removed.length === 0) return { removed: [], changed: [], rootChanged: false };

  const removedSet = new Set<SceneElement>(removed);
  const changed = new Set<Drawable>();
  const lanes = laneNodes(scene);
  // The last pool going hands the study back to its process, before the detach so `releaseProcessRef` keeps it.
  const collaboration = scene.root;
  const process = processLeftByLastPool(scene, removedSet);
  if (process) changeRoot(scene, collaboration, process, ids);

  // Edges first (they only reference), then nodes deepest-first.
  const edges = removed.filter((el): el is SceneEdge => el.kind === 'edge');
  const nodes = removed
    .filter((el): el is SceneNode => el.kind === 'node')
    .sort((a, b) => depthOf(b) - depthOf(a));
  for (const edge of edges) detachEdge(scene, edge, removedSet, changed);
  for (const node of nodes) detachNode(node, scene, lanes, removedSet, changed);
  if (process) retireCollaboration(scene, collaboration, process);

  for (const element of removed) {
    dropLabel(scene, element);
    if (scene.elementsById.get(element.id) === element) scene.elementsById.delete(element.id);
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
  return { removed, changed: [...changed], rootChanged: !!process };
}

/** The process of the collaboration root's first pool, when the deletion takes every pool it has. */
function processLeftByLastPool(scene: Scene, removedSet: Set<SceneElement>): Element | undefined {
  const { model } = scene;
  if (model.host(scene.root) !== 'bpmn:Collaboration') return undefined;
  const pools = listOf(scene.root, 'participants').filter((participant) => participant.processRef);
  const isRemoved = (pool: Element): boolean => {
    const node = scene.elementsById.get(pool.id ?? '');
    return !!node && removedSet.has(node);
  };
  return pools.length > 0 && pools.every(isRemoved) ? refOf(model, pools[0], 'processRef') : undefined;
}

/**
 * The rest of undoing the mutator's `promoteRootToCollaboration`, once the process holds the study again: what
 * the collaboration files beside its pools moves to the process, and the collaboration goes unless actors that
 * only take bands are left in it.
 */
function retireCollaboration(scene: Scene, collaboration: Element, process: Element): void {
  const { model } = scene;
  for (const artifact of listOf(collaboration, 'artifacts')) {
    model.unfile(artifact);
    model.file(artifact, process, 'artifacts');
  }
  if (listOf(collaboration, 'participants').length > 0) return;
  model.unfile(collaboration);
}

function detachEdge(scene: Scene, edge: SceneEdge, removedSet: Set<SceneElement>, changed: Set<Drawable>): void {
  const { model } = scene;
  const flow = edge.element;
  const ends = (key: 'sourceRef' | 'targetRef', drawn: SceneNode | undefined): Element[] =>
    [...new Set([...(drawn ? [drawn.element] : []), ...idsIn(flow[key]).map((id) => model.get(id)).filter((end): end is Element => !!end)])];

  if (isDataAssociationType(edge.type)) pruneDataAssociation(model, flow, activityOf(model, flow));
  for (const end of ends('sourceRef', edge.source)) {
    dropRef(end, 'outgoing', flow);
    if (end.default === flow.id) delete end.default;
  }
  for (const end of ends('targetRef', edge.target)) dropRef(end, 'incoming', flow);
  model.unfile(flow);

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
  const { model } = scene;
  const element = node.element;
  for (const lane of lanes) {
    if (lane !== node && dropRef(lane.element, 'flowNodeRef', element) && !removedSet.has(lane)) changed.add(lane);
  }
  if (node.type === 'bpmn:Participant') releaseProcessRef(node, scene, removedSet);
  const owner = model.unfile(element)?.parent;
  // An emptied lane set is meaningless on its own.
  if (owner && model.host(owner) === 'bpmn:LaneSet' && listOf(owner, 'lanes').length === 0) model.unfile(owner);
}

/** Drop the `bpmn:Process` a deleted pool depicted, unless something still needs it. */
function releaseProcessRef(node: SceneNode, scene: Scene, removedSet: Set<SceneElement>): void {
  const { model } = scene;
  const process = refOf(model, node.element, 'processRef');
  if (!process) return;
  for (const element of scene.elementsById.values()) {
    if (element === node || element.kind !== 'node' || removedSet.has(element)) continue;
    if (idsIn(element.element.processRef)[0] === process.id) return;
  }
  if (scene.root === process) return;
  model.unfile(process);
}
