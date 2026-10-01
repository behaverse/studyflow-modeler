/**
 * A choreography task's bands, read off the study model: who is on top, who is below, and which of them starts the
 * exchange. A plain task names two participants; a typed one (a cognitive task) presents itself on top, its one
 * participant the actor below.
 */
import { idOf, type Element, type StudyModel } from '@core/model/index';
import type { Ids } from '@core/model/items';
import { wiredIn } from '@core/model/parameters';

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
 * What presents a typed task: its type's `meta.presenter`, a template over its attributes (`Behaverse - {instrument}`,
 * `{platform}`), as the Parameters wired into the task set them, else as written. A type that declares none, or a
 * template that comes out empty, presents as the study's software.
 */
export function presenterIn(model: StudyModel, task: Element): string {
  const type = model.extensionType(task);
  const template = type ? model.metamodel.type(type)?.meta.presenter : undefined;
  if (typeof template !== 'string') return DEFAULT_PRESENTER;
  const wired = wiredIn(model, task)?.attributes ?? {};
  const label = template.replace(/\{(\w+)\}/g, (_match, name: string) => {
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
