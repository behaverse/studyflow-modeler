/**
 * Choreography band writes: the inverse of core's `bandsOf`.
 *
 * A choreography task draws three bands: the top participant, its own name, the
 * bottom participant. The outer bands show `participantRef[0|1]`'s name, so editing one
 * renames a `bpmn:Participant` the task references (its siblings may reference it
 * too), minting the pair, and in a process-rooted study the `bpmn:Collaboration`
 * holding it, on the first edit (core's `ensureParticipantsIn`). Band geometry
 * is derived from the task's bounds (core's `choreographyBandHeight`), so it is not written here.
 *
 * Pure with respect to the scene: it writes the study model and reports what changed;
 * the revision bump and the events are the Mutator's.
 */

import { BPMN } from '@core/constants.ts';
import { bandsOf, ensureParticipantsIn, isTypedChoreography } from '@core/model/choreography.ts';
import type { Element, StudyModel } from '@core/model/index.ts';

import { IdGenerator } from '@canvas/study/ids.ts';
import { idsIn, nameOf } from '@canvas/study/elements.ts';
import type { Scene, SceneNode } from '@canvas/study/scene.ts';

/** One of the two participant bands of a choreography task. */
export type ParticipantBand = 'top' | 'bottom';

/** The readers this module inverts, from core: what the bands say, and whether a task is typed. */
export { bandsOf, isTypedChoreography };

/** Whether `node` is drawn as a choreography task. */
export function isChoreographyTask(node: SceneNode): boolean {
  return node.type === BPMN.ChoreographyTask;
}

/** The ids of the task's participants, in order (possibly fewer than two, or none). */
export function participantRefs(task: Element): string[] {
  return idsIn(task.participantRef);
}

/** What a band write did, and which depictions of it went stale. */
export interface BandWrite {
  /** The `bpmn:Participant` the band renders. */
  participant: Element;
  /** Whether the participant pair had to be minted (a study edit in itself). */
  minted: boolean;
  /** Whether the participant's `name` actually changed. */
  renamed: boolean;
}

/**
 * Write a band's text: ensure the participant pair exists, then set that participant's `name`. A typed task's top
 * band reads from the task itself, so it is not written (`undefined`).
 *
 * A `name` that already matches reports `renamed: false` — but a pair that had to be
 * minted is still a study edit, which is why {@link BandWrite} reports both.
 */
export function applyBandName(
  model: StudyModel,
  node: SceneNode,
  band: ParticipantBand,
  name: string,
  ids: IdGenerator,
): BandWrite | undefined {
  const typed = isTypedChoreography(model, node.element);
  if (typed && band === 'top') return undefined;
  const minted = participantRefs(node.element).length < (typed ? 1 : 2);
  const pair = ensureParticipantsIn(model, node.element, ids.minter);
  const participant = band === 'top' ? pair[0] : pair[1];
  const renamed = nameOf(participant) !== name;
  if (renamed) participant.name = name;
  return { participant, minted, renamed };
}

/**
 * Every choreography task in `scene` that references `participant`, with `first` at
 * the head. One participant is shared across the tasks it takes part in, so a rename
 * changes a band on each of them and they all have to be re-drawn.
 */
export function tasksReferencing(scene: Scene | undefined, participant: Element, first: SceneNode): SceneNode[] {
  const out: SceneNode[] = [first];
  if (!scene) return out;
  for (const element of scene.elementsById.values()) {
    if (element.kind !== 'node' || element === first) continue;
    if (!isChoreographyTask(element)) continue;
    if (participantRefs(element.element).includes(participant.id!)) out.push(element);
  }
  return out;
}
