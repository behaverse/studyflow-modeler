/**
 * A choreography task's bands, read off the study model: who is on top, who is below, and which of them starts the
 * exchange. A plain task names two participants; a typed one (a cognitive task) presents itself on top, its one
 * participant the actor below. Who takes the bands, and the kind of actor each is; and another tool's choreography,
 * read as the process a study is.
 */
import { idOf, isElement, type Element, type StudyModel } from '@core/model/index';
import { getCatalog } from '@core/notation';
import type { Ids } from '@core/model/items';
import { wiredIn } from '@core/model/parameters';
import { foldTyped } from '@core/model/yaml';

export const DEFAULT_TOP = 'Participant A';
export const DEFAULT_BOTTOM = 'Participant B';
const DEFAULT_PRESENTER = 'Task software';

/** A typed choreography task presents itself; its one participant reference is the actor. */
export function isTypedChoreography(model: StudyModel, task: Element): boolean {
  return model.extensionType(task) !== undefined;
}

/** The participants the task names, in order. */
function participantsOf(model: StudyModel, task: Element): Element[] {
  const refs = Array.isArray(task.participantRef) ? task.participantRef : [];
  return refs.map((ref) => model.get(idOf(ref) ?? undefined)).filter((participant): participant is Element => !!participant);
}

/** The actor a typed task names: its participant that does not initiate, else its first. */
export function actorIn(model: StudyModel, task: Element): Element | undefined {
  const participants = participantsOf(model, task);
  const initiating = idOf(task.initiatingParticipantRef);
  return participants.find((participant) => participant.id !== initiating) ?? participants[0];
}

/**
 * What presents a typed task: its type's `meta.presenter`, a template naming its attributes in angle brackets
 * (`Behaverse - <instrument>`, `<platform>`; braces are a run's placeholders), as the Parameters wired into the task
 * set them, else as written. A type that declares none, or a template that comes out empty, presents as the study's
 * software.
 */
export function presenterIn(model: StudyModel, task: Element): string {
  const type = model.extensionType(task);
  const template = type ? model.metamodel.type(type)?.meta.presenter : undefined;
  if (typeof template !== 'string') return DEFAULT_PRESENTER;
  const wired = wiredIn(model, task)?.attributes ?? {};
  const label = template.replace(/<(\w+)>/g, (_match, name: string) => {
    const value = name in wired ? wired[name] : model.attribute(task, name);
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }).trim();
  return label || DEFAULT_PRESENTER;
}

/** The task's bands: the top and bottom labels, and which side initiates. */
export function bandsOf(model: StudyModel, task: Element): { top: string; bottom: string; initiator: 'top' | 'bottom' } {
  const name = (participant: Element | undefined): string | undefined => (typeof participant?.name === 'string' && participant.name ? participant.name : undefined);
  if (isTypedChoreography(model, task)) return { top: presenterIn(model, task), bottom: name(actorIn(model, task)) ?? DEFAULT_BOTTOM, initiator: 'top' };
  const [top, bottom] = participantsOf(model, task);
  const initiating = idOf(task.initiatingParticipantRef);
  return {
    top: name(top) ?? DEFAULT_TOP,
    bottom: name(bottom) ?? DEFAULT_BOTTOM,
    initiator: initiating && bottom && initiating === bottom.id && bottom !== top ? 'bottom' : 'top',
  };
}

/**
 * The element that holds a choreography task's participants: its enclosing `bpmn:Choreography` or, in a study rooted
 * on a process, a `bpmn:Collaboration` among its roots. One is made (with no drawing, so its participants live in the
 * file without being drawn) when neither is there.
 */
function participantHolderIn(model: StudyModel, task: Element, ids: Ids): Element {
  for (let at = model.parentOf(task); at; at = model.parentOf(at)) if (model.isA(at, 'bpmn:Collaboration')) return at;
  const existing = model.study.roots.find((root) => model.isA(root, 'bpmn:Collaboration'));
  if (existing) return existing;
  const made: Element = { type: 'bpmn:Collaboration', id: ids.next('Collaboration_'), participants: [] };
  model.study.roots.push(made);
  return made;
}

/** A new participant named `name`, filed with the task's other participants. */
export function mintParticipantIn(model: StudyModel, task: Element, name: string, ids: Ids): Element {
  const holder = participantHolderIn(model, task, ids);
  const participant: Element = { type: 'bpmn:Participant', id: ids.next('Participant_'), name };
  holder.participants = [...(Array.isArray(holder.participants) ? holder.participants : []), participant];
  model.reindex();
  return participant;
}

/**
 * The `[top, bottom]` participants of a choreography task, minting what the study lacks: a plain task gets two, the
 * top one initiating unless the task names one; a typed task gets one, the actor (both bands answer it), and no
 * initiator, since the presenting side is the task itself.
 */
export function ensureParticipantsIn(model: StudyModel, task: Element, ids: Ids): [Element, Element] {
  const list = participantsOf(model, task);
  if (isTypedChoreography(model, task)) {
    if (list.length >= 1) {
      const actor = actorIn(model, task)!;
      return [actor, actor];
    }
    const actor = mintParticipantIn(model, task, 'Participant', ids);
    task.participantRef = [actor.id!];
    delete task.initiatingParticipantRef;
    return [actor, actor];
  }
  if (list.length >= 2) return [list[0], list[1]];
  const top = list[0] ?? mintParticipantIn(model, task, DEFAULT_TOP, ids);
  const bottom = list[1] ?? mintParticipantIn(model, task, DEFAULT_BOTTOM, ids);
  task.participantRef = [top.id!, bottom.id!];
  task.initiatingParticipantRef ??= top.id!;
  return [top, bottom];
}

/** What a choreography root holds that is its own kind's: none of it travels when it is read as a process. */
const CHOREOGRAPHY_OWN = new Set(['type', 'id', 'participants', 'messageFlows', 'isExecutable']);

/**
 * A `bpmn:Choreography` root, from another tool's file, read as the process a study is: its choreography tasks are
 * exchanges in a process, their participants held by a collaboration with no pool. Whether there was one to read.
 */
export function choreographyToProcessIn(model: StudyModel): boolean {
  const { roots } = model.study;
  const choreography = roots.find((root) => model.host(root) === 'bpmn:Choreography');
  if (!choreography) return false;

  const declared = model.metamodel.descriptor('bpmn:Process').propertiesByName;
  const read: Element = { type: 'bpmn:Process', id: choreography.id, isExecutable: false };
  for (const [key, value] of Object.entries(choreography)) {
    if (!CHOREOGRAPHY_OWN.has(key) && (declared[key] || key.includes(':'))) read[key] = value;
  }
  // A Study the choreography carried types the process, as it would have typed a process read as one.
  const process = foldTyped(model.metamodel, read);
  // A study is a process: the choreography's message flows go with its root, and each task keeps its bands.
  for (const element of Array.isArray(process.flowElements) ? process.flowElements : []) {
    if (isElement(element) && model.host(element) === 'bpmn:ChoreographyTask') delete element.messageFlowRef;
  }

  roots.splice(roots.indexOf(choreography), 1, process);
  // A participant is no root element: the ones left need a collaboration to be held by, which draws no pool.
  const participants = Array.isArray(choreography.participants) ? choreography.participants : [];
  if (participants.length > 0) {
    const taken = new Set(roots.map((root) => root.id));
    let id = `${choreography.id}_participants`;
    for (let n = 2; taken.has(id); n++) id = `${choreography.id}_participants_${n}`;
    roots.push({ type: 'bpmn:Collaboration', id, participants });
  }
  model.reindex();
  return true;
}

/* --- Who takes a band, and what kind of actor that is --- */

/** A pool on the canvas, as against an actor that only takes bands: one with a process, or one the study draws
 * (a model's pool has no process of its own). */
export function isPool(model: StudyModel, participant: Element | undefined): boolean {
  return Boolean(participant?.processRef) || Boolean(participant?.id && participant.id in model.study.layout);
}

/** A new actor for a typed task, named as typed, put on its band in place of a drawn pool that must keep its name. */
export function nameNewActor(model: StudyModel, task: Element, ids: Ids, name: string): void {
  selectBandParticipant(model, task, ids, 'bottom', mintParticipantIn(model, task, name, ids));
}

const refsOf = (element: Element): string[] => (Array.isArray(element.participantRef) ? element.participantRef.map(idOf).filter((id): id is string => !!id) : []);

/** Drop a participant that only ever took bands and takes none any more; a pool on the canvas stays. */
function dropIfOrphan(model: StudyModel, task: Element, participant: Element | undefined): void {
  if (!participant || isPool(model, participant)) return;
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
export function selectBandParticipant(model: StudyModel, task: Element, ids: Ids, band: 'top' | 'bottom', participant: Element | null): void {
  if (isTypedChoreography(model, task)) {
    const replaced = actorIn(model, task);
    if (replaced?.id === participant?.id) return;
    task.participantRef = participant ? [participant.id!] : [];
    delete task.initiatingParticipantRef;
    dropIfOrphan(model, task, replaced);
    return;
  }
  const [top, bottom] = ensureParticipantsIn(model, task, ids);
  const replaced = band === 'top' ? top : bottom;
  if (replaced.id === participant?.id) return;
  const next = participant ?? mintParticipantIn(model, task, band === 'top' ? DEFAULT_TOP : DEFAULT_BOTTOM, ids);
  task.participantRef = band === 'top' ? [next.id!, bottom.id!] : [top.id!, next.id!];
  if (idOf(task.initiatingParticipantRef) === replaced.id) task.initiatingParticipantRef = next.id!;
  dropIfOrphan(model, task, replaced);
}

/** A participant on a band: one the study declares, by its id; or a name, which the band's participant takes (a drawn
 * pool on a typed task keeps its own, and a new actor of that name takes the band); or none (`null`). */
export type BandChange = { participant: string } | { name: string } | null;

/**
 * Who takes a choreography task's bands, and how: each band given, the participant on it; `initiator`, which band
 * starts the exchange; `kinds`, what kind of actor the participant on a band is (a kind's id, or `''` for none).
 * The participants the task lacks are minted, and one that took only this task's band and takes none any more goes.
 * Throws when a participant or a kind it names does not exist.
 */
export function setBandsIn(model: StudyModel, task: Element, ids: Ids, change: { top?: BandChange; bottom?: BandChange; initiator?: 'top' | 'bottom'; kinds?: { top?: string; bottom?: string } }): void {
  for (const band of ['top', 'bottom'] as const) {
    const wanted = change[band];
    if (wanted === undefined) continue;
    if (wanted === null) {
      selectBandParticipant(model, task, ids, band, null);
    } else if ('participant' in wanted) {
      const participant = model.get(wanted.participant);
      if (!participant || model.host(participant) !== 'bpmn:Participant') throw new Error(`no participant '${wanted.participant}'`);
      selectBandParticipant(model, task, ids, band, participant);
    } else {
      const [top, bottom] = ensureParticipantsIn(model, task, ids);
      const participant = band === 'top' ? top : bottom;
      // A typed task's actor that is a drawn pool keeps its name: another name is a new actor for this task.
      if (isTypedChoreography(model, task) && isPool(model, participant)) nameNewActor(model, task, ids, wanted.name);
      else participant.name = wanted.name;
    }
  }
  if (change.initiator) {
    const [top, bottom] = ensureParticipantsIn(model, task, ids);
    task.initiatingParticipantRef = (change.initiator === 'bottom' ? bottom : top).id!;
  }
  for (const band of ['top', 'bottom'] as const) {
    const kind = change.kinds?.[band];
    if (kind === undefined) continue;
    if (kind && !participantKinds().some((candidate) => candidate.id === kind)) throw new Error(`no participant kind '${kind}'`);
    const [top, bottom] = ensureParticipantsIn(model, task, ids);
    setParticipantKind(model, band === 'top' ? top : bottom, kind);
  }
}
