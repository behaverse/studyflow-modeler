/**
 * Choreography band writes: the inverse of core's `readChoreographyBands`.
 *
 * A choreography task draws three bands: the top participant, its own name, the
 * bottom participant. The outer bands show `participantRef[0|1].name`, so editing one
 * renames a `bpmn:Participant` the task references (its siblings may reference it
 * too), minting the pair, and in a process-rooted document the `bpmn:Collaboration`
 * holding it, on the first edit (core's `ensureChoreographyParticipants`). Band geometry
 * is derived from the task's bounds (core's `choreographyBandHeight`) and `messageFlowRef`
 * is rebuilt on save (core's `processToChoreographyRoot`), so neither is written here.
 *
 * Pure with respect to the scene: it mutates the moddle tree and reports what changed;
 * the revision bump and the events are the Mutator's.
 */

import { BPMN } from '@core/constants.ts';
import { ensureChoreographyParticipants, isTypedChoreography, readChoreographyBands } from '@core/document/index.ts';
import { getProperty, setProperty } from '@core/element/moddle.ts';

import { IdGenerator } from '@canvas/study/ids.ts';
import { asList, nameOf } from '@canvas/study/moddle.ts';
import type { ModdleObject, Scene, SceneNode } from '@canvas/study/scene.ts';

/** One of the two participant bands of a choreography task. */
export type ParticipantBand = 'top' | 'bottom';

/** The readers this module inverts, from core: what the bands say, and whether a task is typed. */
export { isTypedChoreography, readChoreographyBands };

/** Whether `type` is drawn as a choreography task (two bands + a name band). */
function isChoreographyType(type: string): boolean {
  return type === BPMN.ChoreographyTask;
}

/** Whether `node` is drawn as a choreography task. */
export function isChoreographyTask(node: SceneNode): boolean {
  return isChoreographyType(node.type);
}

/** The task's ordered `participantRef` list (possibly shorter than two, or empty). */
export function participantRefs(bo: ModdleObject): ModdleObject[] {
  return asList(getProperty(bo, 'participantRef'));
}

/** What a band write did, and which depictions of it went stale. */
export interface BandWrite {
  /** The `bpmn:Participant` the band renders. */
  participant: ModdleObject;
  /** Whether the participant pair had to be minted (a document edit in itself). */
  minted: boolean;
  /** Whether the participant's `name` actually changed. */
  renamed: boolean;
}

/**
 * Write a band's text: ensure the participant pair exists, then set that
 * participant's `name`. Returns `undefined` when the pair could not be resolved (no
 * moddle factory), so the caller writes nothing at all.
 *
 * A `name` that already matches reports `renamed: false` — but a pair that had to be
 * minted is still a document edit, which is why {@link BandWrite} reports both.
 */
export function applyBandName(
  node: SceneNode,
  band: ParticipantBand,
  name: string,
  ids: IdGenerator,
): BandWrite | undefined {
  const typed = isTypedChoreography(node.businessObject);
  if (typed && band === 'top') return undefined; // the presenter's band reads from the task itself
  const minted = participantRefs(node.businessObject).length < (typed ? 1 : 2);
  const pair = ensureChoreographyParticipants(node.businessObject, ids);
  if (!pair) return undefined;
  const participant = (band === 'top' ? pair[0] : pair[1]) as ModdleObject;
  const renamed = nameOf(participant) !== name;
  if (renamed) setProperty(participant, 'name', name);
  return { participant, minted, renamed };
}

/**
 * Every choreography task in `scene` that references `participant`, with `first` at
 * the head. One participant is shared across the tasks it takes part in, so a rename
 * changes a band on each of them and they all have to be re-drawn.
 */
export function tasksReferencing(
  scene: Scene | undefined,
  participant: ModdleObject,
  first: SceneNode,
): SceneNode[] {
  const out: SceneNode[] = [first];
  if (!scene) return out;
  for (const element of scene.elementsById.values()) {
    if (element.kind !== 'node' || element === first) continue;
    if (!isChoreographyTask(element)) continue;
    if (participantRefs(element.businessObject).includes(participant)) out.push(element);
  }
  return out;
}
