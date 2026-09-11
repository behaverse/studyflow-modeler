/**
 * Choreography band writes: the inverse of core's `readChoreographyBands`.
 *
 * A choreography task draws three bands: the top participant, its own name, the
 * bottom participant. The outer bands show `participantRef[0|1].name`, so editing one
 * renames a `bpmn:Participant` the task references (its siblings may reference it
 * too), minting the pair, and in a process-rooted document the `bpmn:Collaboration`
 * holding it, on the first edit. Band geometry is derived from the task's bounds
 * (`render/shapes.ts` `choreographyBandHeight`) and `messageFlowRef` is rebuilt on save
 * (core's `processToChoreographyRoot`), so neither is written here.
 *
 * Pure with respect to the scene: it mutates the moddle tree and reports what changed;
 * the revision bump and the events are the Mutator's.
 */

import { BPMN } from '@core/constants.ts';
import { actorOf, DEFAULT_BOTTOM, DEFAULT_TOP, isTypedChoreography, readChoreographyBands } from '@core/document/index.ts';

import { IdGenerator } from '@canvas/model/ids.ts';
import {
  asList,
  definitionsAbove,
  mint,
  modelOf,
  nameOf,
  parentOf,
  prop,
  setParent,
  setProp,
} from '@canvas/model/moddle.ts';
import type { ModdleObject, Scene, SceneElement, SceneNode } from '@canvas/model/scene.ts';

/** One of the two participant bands of a choreography task. */
export type ParticipantBand = 'top' | 'bottom';

/** What mints the ids of new participants and of the collaboration that holds them. */
type Ids = Pick<IdGenerator, 'nextPrefixed'>;

/** The readers this module inverts, from core: what the bands say, and who a typed task names. */
export { actorOf, DEFAULT_BOTTOM, DEFAULT_TOP, isTypedChoreography, readChoreographyBands };

/** Whether `type` is drawn as a choreography task (two bands + a name band). */
export function isChoreographyType(type: string): boolean {
  return type === BPMN.ChoreographyTask;
}

/** Whether `node` is drawn as a choreography task. */
export function isChoreographyTask(node: SceneNode): boolean {
  return isChoreographyType(node.type);
}

/** The task's ordered `participantRef` list (possibly shorter than two, or empty). */
export function participantRefs(bo: ModdleObject): ModdleObject[] {
  return asList(prop(bo, 'participantRef'));
}

/**
 * The element that owns `participants` for a choreography task — its enclosing
 * `bpmn:Choreography` (the studyflow choreography root) or, in a process-rooted
 * document, a `bpmn:Collaboration` among the root elements. One is created (with no
 * DI plane, so its participants live in the XML without drawing) when neither exists.
 */
function participantHolder(bo: ModdleObject, ids: Ids): ModdleObject | undefined {
  let current: ModdleObject | undefined = parentOf(bo);
  const seen = new Set<ModdleObject>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (Array.isArray(prop(current, 'participants'))) return current;
    current = parentOf(current);
  }

  const definitions = definitionsAbove(bo);
  if (!definitions) return undefined;
  const roots = asList(prop(definitions, 'rootElements'));
  const existing = roots.find((re) => Array.isArray(prop(re, 'participants')));
  if (existing) return existing;

  const factory = modelOf(definitions);
  if (!factory?.create) return undefined;
  const created = mint(factory, 'bpmn:Collaboration', {
    id: ids.nextPrefixed('Collaboration_'),
    participants: [],
  });
  setParent(created, definitions);
  setProp(definitions, 'rootElements', [...roots, created]);
  return created;
}

/** A new participant named `name`, filed with the task's other participants; `undefined` without a moddle factory. */
export function mintParticipant(bo: ModdleObject, name: string, ids: Ids): ModdleObject | undefined {
  const factory = modelOf(bo) ?? modelOf(definitionsAbove(bo));
  const holder = factory?.create ? participantHolder(bo, ids) : undefined;
  if (!factory || !holder) return undefined;
  const participant = mint(factory, 'bpmn:Participant', { id: ids.nextPrefixed('Participant_'), name });
  setParent(participant, holder);
  setProp(holder, 'participants', [...asList(prop(holder, 'participants')), participant]);
  return participant;
}

/**
 * The `[top, bottom]` participants of a choreography task, minting what the document lacks: a plain
 * task gets two, the top one initiating unless the task names one; a typed task gets one, the actor
 * (both bands answer it), and no initiator, since the presenting side is the task itself. The writes go
 * straight onto moddle; the caller records the edit. `undefined` when there is no moddle factory.
 */
export function ensureChoreographyParticipants(bo: ModdleObject, ids: Ids): [ModdleObject, ModdleObject] | undefined {
  const list = participantRefs(bo);
  const typed = isTypedChoreography(bo);
  if (typed && list.length >= 1) {
    const actor = actorOf(bo) as ModdleObject;
    return [actor, actor];
  }
  if (list.length >= 2) return [list[0], list[1]];
  if (typed) {
    const actor = mintParticipant(bo, 'Participant', ids);
    if (!actor) return undefined;
    setProp(bo, 'participantRef', [actor]);
    setProp(bo, 'initiatingParticipantRef', undefined);
    return [actor, actor];
  }
  const top = list[0] ?? mintParticipant(bo, DEFAULT_TOP, ids);
  const bottom = list[1] ?? mintParticipant(bo, DEFAULT_BOTTOM, ids);
  if (!top || !bottom) return undefined;
  setProp(bo, 'participantRef', [top, bottom]);
  setProp(bo, 'initiatingParticipantRef', prop(bo, 'initiatingParticipantRef') ?? top);
  return [top, bottom];
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
  const participant = band === 'top' ? pair[0] : pair[1];
  const renamed = nameOf(participant) !== name;
  if (renamed) setProp(participant, 'name', name);
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
): SceneElement[] {
  const out: SceneElement[] = [first];
  if (!scene) return out;
  for (const element of scene.elementsById.values()) {
    if (element.kind !== 'node' || element === first) continue;
    if (!isChoreographyTask(element)) continue;
    if (participantRefs(element.businessObject).includes(participant)) out.push(element);
  }
  return out;
}
