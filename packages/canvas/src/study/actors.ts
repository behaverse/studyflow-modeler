/**
 * Every actor drawn. A `bpmn:Participant` with no process is BPMN's black box: a band names one, a file declares one,
 * and the canvas draws each as a collapsed pool under the rest of the diagram, the study's own flow made a pool of
 * the collaboration first, as drawing any pool makes it. A black box the last band stopped naming goes again, unless
 * a message flow reaches it. Pure with respect to the commit: the mutator records what it adds and removes.
 */

import type { Element, StudyModel } from '@core/model/index.ts';

import { idsIn, listOf } from '@canvas/study/elements.ts';
import { collapsedPoolBelow } from '@canvas/study/layout.ts';
import type { Mutator } from '@canvas/study/mutator.ts';
import { defaultSizeFor } from '@canvas/study/prototype.ts';
import type { Bounds, Drawable, Scene, SceneNode } from '@canvas/study/scene.ts';
import { boundsOf } from '@canvas/study/tree.ts';

/** The actors the study declares that depict no process: what a band names, what a person or a runner plays. */
export function blackBoxesOf(model: StudyModel): Element[] {
  return model.study.roots
    .filter((root) => model.host(root) === 'bpmn:Collaboration')
    .flatMap((root) => listOf(root, 'participants'))
    .filter((actor) => typeof actor.id === 'string' && !actor.processRef);
}

/**
 * Draw a collapsed pool for each black box the scene draws nowhere, the study's flow in a pool of the collaboration
 * first when the root is still a process; the pools added, none when every actor is drawn.
 */
export function drawActors(mutator: Mutator, scene: Scene): SceneNode[] {
  const undrawn = blackBoxesOf(scene.model).filter((actor) => !scene.elementsById.has(actor.id!));
  if (undrawn.length === 0) return [];
  const added: SceneNode[] = [];
  if (scene.model.host(scene.root) === 'bpmn:Process') added.push(mutator.addShape({ type: 'bpmn:Participant', bounds: flowBounds(scene) }));
  for (const actor of undrawn) added.push(mutator.addShape({ type: 'bpmn:Participant', element: actor, bounds: collapsedPoolBelow(scene), isExpanded: false }));
  return added;
}

/** The box the study's flow is drawn in, for the pool that takes it over: round what the top level draws, a pool's size at least. */
function flowBounds(scene: Scene): Bounds {
  const size = defaultSizeFor('bpmn:Participant');
  const drawn = scene.rootElement.children.filter((child): child is Drawable => child.kind !== 'label' && !(child.kind === 'node' && child.type === 'bpmn:Participant'));
  const hull = boundsOf(drawn);
  return hull ? { ...hull, width: Math.max(hull.width, size.width), height: Math.max(hull.height, size.height) } : { x: 100, y: 100, ...size };
}

/** The actors some choreography task's band names now, by id. */
export function namedActors(scene: Scene): Set<string> {
  const { model } = scene;
  const named = new Set<string>();
  for (const element of model.all()) {
    if (model.host(element) === 'bpmn:ChoreographyTask') for (const id of idsIn(element.participantRef)) named.add(id);
  }
  return named;
}

/**
 * Take away the black boxes among `were`, the actors bands named before an edit, that no band names any more: a pool
 * a band declared goes with its last band, as long as it holds nothing and no message flow reaches it. The pools removed.
 */
export function retireActors(mutator: Mutator, scene: Scene, were: Iterable<string>): SceneNode[] {
  const named = namedActors(scene);
  const gone: SceneNode[] = [];
  for (const id of were) {
    const node = scene.elementsById.get(id);
    if (node?.kind !== 'node' || node.type !== 'bpmn:Participant' || named.has(id)) continue;
    if (node.element.processRef || node.children.length > 0 || node.incoming.length + node.outgoing.length > 0) continue;
    gone.push(node);
  }
  if (gone.length > 0) mutator.deleteElements(gone);
  return gone;
}

/** After an edit: the black boxes it left unnamed go, and the actors it declared and drew nowhere are drawn, where those stood. */
export function settleActors(mutator: Mutator, scene: Scene, named: ReadonlySet<string>): void {
  retireActors(mutator, scene, named);
  drawActors(mutator, scene);
}
