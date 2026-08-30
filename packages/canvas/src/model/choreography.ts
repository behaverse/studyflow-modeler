/**
 * Choreography band writeback — the **inverse** of `@core/document/choreography`'s
 * `readChoreographyBands` (design §1, §2 "ChoreographyTask — two participant bands
 * + middle name band", §6 P5).
 *
 * A choreography task is drawn as three stacked bands: the top participant, the
 * task's own name, the bottom participant. Only the middle band's text belongs to
 * the task — the two outer bands render `participantRef[0].name` and
 * `participantRef[1].name`, and which of the two is *initiating* decides the band
 * shading (`initiatingParticipantRef`). So editing a band is never a `name` write on
 * the element under the pointer; it is a write on a `bpmn:Participant` that the task
 * merely references, and that its siblings usually reference too.
 *
 * What this module owns, and what it deliberately does not:
 *
 * - **Owns** the three writes that make up the inverse of `readChoreographyBands` —
 *   `participantRef` (the ordered pair), the participants' `name`, and
 *   `initiatingParticipantRef` — plus minting the pair (and, in a process-rooted
 *   document, the `bpmn:Collaboration` that holds it) the first time a band is
 *   edited. Ported from the modeler's `bpmn/choreographyParticipants.ts`, minus its
 *   `modeling`/`bpmnFactory` services: everything is mutated in place through moddle.
 * - **Does not** touch geometry. Band geometry is *derived*, never stored: the DI
 *   carries one `dc:Bounds` for the whole task and `render/shapes.ts`
 *   `choreographyBandHeight(height) = min(20, ⌊height/3⌋)` splits it. There is no
 *   per-band `BPMNShape` in a studyflow document (unlike the optional BPMN-DI
 *   participant-band shapes), so a rename cannot desynchronize band geometry, and a
 *   resize keeps all three bands proportional for free — the `bpmn:ChoreographyActivity`
 *   floor in `rules/rules.ts` `MIN_SIZES` (100×80) keeps every band drawable.
 * - **Does not** touch `messageFlowRef`. The app strips message flows on import and
 *   rebuilds them on save (`@core/document/choreography.ts`
 *   `choreographyToProcessRoot` / `processToChoreographyRoot`), so a canvas-side
 *   write would be overwritten at best and duplicated at worst.
 *
 * Like `model/remove.ts` and `model/expand.ts` this module is pure with respect to
 * the scene bookkeeping: it mutates the moddle tree and reports what changed, while
 * the revision bump and the bus events stay in `model/writeback.ts`.
 */

import { BPMN } from '@core/constants.ts';

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

/**
 * Placeholder band names for a choreography task with no participants yet. Mirrors
 * `@core/document/choreography`'s `DEFAULT_TOP`/`DEFAULT_BOTTOM` — kept as local
 * constants (and pinned by a test) rather than imported, because that core module
 * pulls the whole document/format layer, and its `bpmn-moddle` types, into a package
 * that must stay a leaf.
 */
export const DEFAULT_TOP = 'Participant A';
/** @see DEFAULT_TOP */
export const DEFAULT_BOTTOM = 'Participant B';

/** Whether `type` is drawn as a choreography task (two bands + a name band). */
export function isChoreographyType(type: string): boolean {
  return type === BPMN.ChoreographyTask;
}

/** Whether `node` is drawn as a choreography task. */
export function isChoreographyTask(node: SceneNode): boolean {
  return isChoreographyType(node.type);
}

/** What the three bands of a choreography task read, and which side initiates. */
export interface ChoreographyBands {
  top: string;
  bottom: string;
  initiator: ParticipantBand;
}

/**
 * The two band names of a choreography task plus which side initiates — a local
 * mirror of `@core/document/choreography`'s `readChoreographyBands`, including its
 * fallback to the placeholder names when a participant carries none.
 */
export function readChoreographyBands(bo: ModdleObject): ChoreographyBands {
  const list = participantRefs(bo);
  const top = list[0];
  const bottom = list[1];
  const initiating = prop(bo, 'initiatingParticipantRef');
  return {
    top: nameOf(top) || DEFAULT_TOP,
    bottom: nameOf(bottom) || DEFAULT_BOTTOM,
    initiator: initiating && initiating === bottom && bottom !== top ? 'bottom' : 'top',
  };
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
function participantHolder(bo: ModdleObject, ids: IdGenerator): ModdleObject | undefined {
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

/**
 * The `[top, bottom]` participants of a choreography task, creating either that the
 * document lacks (ported from the modeler's `ensureChoreographyParticipants`, minus
 * its `modeling`/`bpmnFactory` services). A freshly minted pair is filed in the
 * holder's `participants`, referenced from the task's `participantRef` in band order,
 * and the top one becomes the initiator unless the task already named one.
 *
 * Returns `undefined` when the document offers no moddle factory to mint with, in
 * which case a band edit is skipped rather than silently dropped.
 */
export function ensureChoreographyParticipants(
  node: SceneNode,
  ids: IdGenerator,
): [ModdleObject, ModdleObject] | undefined {
  const bo = node.businessObject;
  const list = participantRefs(bo);
  if (list.length >= 2) return [list[0], list[1]];

  const factory = modelOf(bo) ?? modelOf(definitionsAbove(bo));
  if (!factory?.create) return undefined;
  const holder = participantHolder(bo, ids);
  if (!holder) return undefined;

  const make = (name: string): ModdleObject => mint(factory, 'bpmn:Participant', {
    id: ids.nextPrefixed('Participant_'),
    name,
  });
  const top = list[0] ?? make(DEFAULT_TOP);
  const bottom = list[1] ?? make(DEFAULT_BOTTOM);
  const fresh = [top, bottom].filter((_participant, i) => !list[i]);

  for (const participant of fresh) setParent(participant, holder);
  const held = asList(prop(holder, 'participants'));
  setProp(holder, 'participants', [...held, ...fresh]);
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
  const minted = participantRefs(node.businessObject).length < 2;
  const pair = ensureChoreographyParticipants(node, ids);
  if (!pair) return undefined;
  const participant = band === 'top' ? pair[0] : pair[1];
  const renamed = nameOf(participant) !== name;
  if (renamed) setProp(participant, 'name', name);
  return { participant, minted, renamed };
}

/**
 * Point `initiatingParticipantRef` at the participant of `band` — the inverse of
 * `readChoreographyBands`'s `initiator`. Returns whether anything was written.
 */
export function applyInitiator(
  node: SceneNode,
  band: ParticipantBand,
  ids: IdGenerator,
): boolean {
  const pair = ensureChoreographyParticipants(node, ids);
  if (!pair) return false;
  const next = band === 'top' ? pair[0] : pair[1];
  // A pair minted just now already points at the top one, which is still a change
  // when the caller asked for the bottom.
  if (prop(node.businessObject, 'initiatingParticipantRef') === next) return false;
  setProp(node.businessObject, 'initiatingParticipantRef', next);
  return true;
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
