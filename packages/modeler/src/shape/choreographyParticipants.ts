import { DEFAULT_BOTTOM, DEFAULT_TOP, actorIn, ensureParticipantsIn, isTypedChoreography, mintParticipantIn } from '@core/model/choreography';
import { idOf, isElement, type Element, type StudyModel } from '@core/model/index';
import type { Ids } from '@core/model/items';
import { getCatalog } from '@core/notation';

/* Who takes a choreography task's bands, as inspector edits: each changes the study model a `study.revise` hands it,
   the participants minted by core's `ensureParticipantsIn` and `mintParticipantIn`. */

/** What finds what the study draws, by id: the editor's study. */
type Drawn = { get(id: string): unknown };

/** A pool on the canvas, as against an actor that only takes bands: one with a process, or one the study draws
 * (a model's pool has no process of its own). */
export function isPool(participant: Element | undefined, drawn: Drawn): boolean {
  return Boolean(participant?.processRef) || Boolean(participant?.id && drawn.get(participant.id));
}

/** A new actor for a typed task, named as typed, put on its band in place of a drawn pool that must keep its name. */
export function nameNewActor(model: StudyModel, task: Element, ids: Ids, drawn: Drawn, name: string): void {
  selectBandParticipant(model, task, ids, drawn, 'bottom', mintParticipantIn(model, task, name, ids));
}

const refsOf = (element: Element): string[] => (Array.isArray(element.participantRef) ? element.participantRef.map(idOf).filter((id): id is string => !!id) : []);

/** Drop a participant that only ever took bands and takes none any more; a pool on the canvas stays. */
function dropIfOrphan(model: StudyModel, task: Element, drawn: Drawn, participant: Element | undefined): void {
  if (!participant || isPool(participant, drawn)) return;
  if ([...model.all()].some((element) => element !== task && refsOf(element).includes(participant.id!))) return;
  const holder = model.parentOf(participant);
  if (!holder || !Array.isArray(holder.participants)) return;
  holder.participants = holder.participants.filter((held) => held !== participant);
  model.reindex();
}

export function swapChoreographyInitiator(model: StudyModel, task: Element, ids: Ids): void {
  const [top, bottom] = ensureParticipantsIn(model, task, ids);
  task.initiatingParticipantRef = idOf(task.initiatingParticipantRef) === top.id ? bottom.id! : top.id!;
}

/* --- Choosing who takes a band, and what kind of actor that is --- */

/**
 * A kind an actor that only takes bands can be, from a `bpmn:Participant` type's `meta.participantKind`: the name
 * of one of its enum attributes (one kind per literal) or the label of the one kind the type itself is.
 */
export type ParticipantKind = {
  /** The picker's value: the literal's, or the type's name. */
  id: string;
  label: string;
  /** The extension that types the participant. */
  type: string;
  /** The attribute and literal that pick this kind among its type's, when the type has more than one. */
  attribute?: string;
  value?: string;
};

/** Every kind the loaded schemas declare, in catalog order. */
export function participantKinds(): ParticipantKind[] {
  const catalog = getCatalog();
  return catalog.allTypes().flatMap((type) => {
    const key = type.meta?.participantKind;
    if (typeof key !== 'string' || type.isAbstract || type.bpmnType !== 'bpmn:Participant') return [];
    const attribute = type.attributes.find((spec) => spec.ns.localName === key);
    const literals = attribute ? catalog.enumOf(attribute.type, type.ns.prefix)?.literals : undefined;
    if (!literals) return [{ id: type.name, label: key, type: type.name }];
    return literals.map((literal) => ({
      id: String(literal.value), label: literal.name, type: type.name, attribute: key, value: String(literal.value),
    }));
  });
}

/** Every participant the study declares: the pools drawn on the canvas and the actors that only take bands. */
export function listParticipants(model: StudyModel): Element[] {
  return model.study.roots
    .filter((root) => model.isA(root, 'bpmn:Collaboration'))
    .flatMap((holder) => (Array.isArray(holder.participants) ? holder.participants.filter(isElement) : []));
}

/** What types a participant: itself, when a schema types it, and the entries it carries. */
const typingsOf = (model: StudyModel, participant: Element): Element[] =>
  [...(model.host(participant) !== participant.type ? [participant] : []), ...model.entries(participant)];

/** The participant's kind from its type: the type it carries and, among that type's kinds, the one its attribute picks (its default when unset). */
export function participantKind(model: StudyModel, participant: Element | undefined): ParticipantKind | undefined {
  if (!participant) return undefined;
  const kinds = participantKinds();
  for (const typed of typingsOf(model, participant)) {
    const ofType = kinds.filter((kind) => kind.type.toLowerCase() === typed.type.toLowerCase());
    if (ofType.length === 0) continue;
    const attribute = ofType[0].attribute;
    if (!attribute) return ofType[0];
    const value = String(model.attributeOrDefault(participant, attribute) ?? '');
    return ofType.find((kind) => kind.value === value) ?? ofType[0];
  }
  return undefined;
}

/** The participant as the BPMN participant it is, with no schema type and no entries. */
function untype(model: StudyModel, participant: Element): void {
  const typed = model.typedEntry(participant);
  if (typed) {
    for (const key of Object.keys(typed)) if (key !== 'type') delete participant[key];
    participant.type = model.host(participant);
  }
  delete participant.extensionElements;
}

/**
 * Type a participant that only takes bands as the kind `id` names, or untype it (`''`). The participant has no
 * shape, so the edit is about the task whose band shows it.
 */
export function setParticipantKind(model: StudyModel, participant: Element | undefined, id: string): void {
  if (!participant || (participantKind(model, participant)?.id ?? '') === id) return;
  if (!id) {
    untype(model, participant);
    return;
  }
  const kind = participantKinds().find((candidate) => candidate.id === id);
  if (!kind) return;
  const current = typingsOf(model, participant).find((typed) => typed.type.toLowerCase() === kind.type.toLowerCase());
  if (current && kind.attribute) { // the same type, another of its kinds
    current[kind.attribute] = kind.value!;
    return;
  }
  untype(model, participant);
  participant.extensionElements = [{ type: kind.type, ...(kind.attribute ? { [kind.attribute]: kind.value! } : {}) }];
}

/**
 * Put an existing participant (a pool, or an actor) on a band, or clear the band with `null`: a typed task then
 * falls back to the pool it sits in, a plain task gets a fresh placeholder. The initiator follows a replaced band.
 */
export function selectBandParticipant(model: StudyModel, task: Element, ids: Ids, drawn: Drawn, band: 'top' | 'bottom', participant: Element | null): void {
  if (isTypedChoreography(model, task)) {
    const replaced = actorIn(model, task);
    if (replaced?.id === participant?.id) return;
    task.participantRef = participant ? [participant.id!] : [];
    delete task.initiatingParticipantRef;
    dropIfOrphan(model, task, drawn, replaced);
    return;
  }
  const [top, bottom] = ensureParticipantsIn(model, task, ids);
  const replaced = band === 'top' ? top : bottom;
  if (replaced.id === participant?.id) return;
  const next = participant ?? mintParticipantIn(model, task, band === 'top' ? DEFAULT_TOP : DEFAULT_BOTTOM, ids);
  task.participantRef = band === 'top' ? [next.id!, bottom.id!] : [top.id!, next.id!];
  if (idOf(task.initiatingParticipantRef) === replaced.id) task.initiatingParticipantRef = next.id!;
  dropIfOrphan(model, task, drawn, replaced);
}
