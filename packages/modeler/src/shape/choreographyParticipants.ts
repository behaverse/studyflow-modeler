import { DEFAULT_BOTTOM, DEFAULT_TOP, actorOf, isTypedChoreography } from '@core/document';
import { getAttribute } from '@core/element';
import { getCatalog } from '@core/notation';

function definitionsOf(bo: any): any {
  while (bo && bo.$type !== 'bpmn:Definitions') bo = bo.$parent;
  return bo;
}

function participantHolder(definitions: any): any {
  return (definitions?.get('rootElements') ?? []).find((re: any) => re.$type === 'bpmn:Collaboration');
}

/** The collaboration is created with no DI plane, so participants live in the XML without drawing on the canvas. */
export function ensureChoreographyParticipants(element: any, modeling: any, bpmnFactory: any): [any, any] {
  const bo = element.businessObject;
  const refs: any[] = bo.get('participantRef') ?? [];
  const typed = isTypedChoreography(bo);
  if (typed && refs.length >= 1) {
    const actor = actorOf(bo);
    return [actor, actor];
  }
  if (refs.length >= 2) return [refs[0], refs[1]];

  // A typed task presents itself: one participant, the actor. A plain one has two of its own.
  const top = refs[0] ?? bpmnFactory.create('bpmn:Participant', { name: typed ? 'Participant' : DEFAULT_TOP });
  const bottom = typed ? top : (refs[1] ?? bpmnFactory.create('bpmn:Participant', { name: DEFAULT_BOTTOM }));
  const fresh = typed ? [top] : [top, bottom].filter((_p, i) => !refs[i]);
  declareParticipants(element, modeling, bpmnFactory, fresh);
  modeling.updateModdleProperties(element, bo, typed
    ? { participantRef: [top], initiatingParticipantRef: undefined }
    : { participantRef: [top, bottom], initiatingParticipantRef: bo.get('initiatingParticipantRef') ?? top });
  return [top, bottom];
}

/** File participants in the collaboration that holds them, creating that collaboration (undrawn) when there is none. */
function declareParticipants(element: any, modeling: any, bpmnFactory: any, fresh: any[]): void {
  if (fresh.length === 0) return;
  const definitions = definitionsOf(element.businessObject);
  let collaboration = participantHolder(definitions);
  if (!collaboration) {
    collaboration = bpmnFactory.create('bpmn:Collaboration', { participants: [] });
    collaboration.$parent = definitions;
    modeling.updateModdleProperties(element, definitions, {
      rootElements: [...(definitions.get('rootElements') ?? []), collaboration],
    });
  }
  for (const p of fresh) p.$parent = collaboration;
  modeling.updateModdleProperties(element, collaboration, {
    participants: [...(collaboration.get('participants') ?? []), ...fresh],
  });
}

/** A new actor for a typed task, named as typed, put on its band in place of a drawn pool that must keep its name. */
export function nameNewActor(element: any, modeling: any, bpmnFactory: any, name: string): any {
  const actor = bpmnFactory.create('bpmn:Participant', { name });
  declareParticipants(element, modeling, bpmnFactory, [actor]);
  selectBandParticipant(element, modeling, bpmnFactory, 'bottom', actor);
  return actor;
}

/** Whether another choreography task in the file still shows `participant` on a band. */
function referencedElsewhere(definitions: any, participant: any, except: any): boolean {
  const visit = (container: any): boolean => (container?.get?.('flowElements') ?? container?.flowElements ?? [])
    .some((el: any) => (el !== except && (el.get?.('participantRef') ?? el.participantRef ?? []).includes(participant)) || visit(el));
  return (definitions?.get?.('rootElements') ?? definitions?.rootElements ?? []).some(visit);
}

/** Drop a participant that only ever took bands and takes none any more; a pool on the canvas stays. */
function dropIfOrphan(element: any, modeling: any, participant: any): void {
  if (!participant || participant.processRef) return;
  const definitions = definitionsOf(participant);
  if (referencedElsewhere(definitions, participant, element.businessObject)) return;
  const holder = participant.$parent;
  const held: any[] = holder?.get?.('participants') ?? holder?.participants ?? [];
  if (!holder || !held.includes(participant)) return;
  modeling.updateModdleProperties(element, holder, { participants: held.filter((p: any) => p !== participant) });
}

export function swapChoreographyInitiator(element: any, modeling: any, bpmnFactory: any): void {
  const bo = element.businessObject;
  const [top, bottom] = ensureChoreographyParticipants(element, modeling, bpmnFactory);
  const initiating = bo.get('initiatingParticipantRef');
  modeling.updateModdleProperties(element, bo, {
    initiatingParticipantRef: initiating === top ? bottom : top,
  });
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

/** Every participant the file declares: the pools drawn on the canvas and the actors that only take bands. */
export function listParticipants(bo: any): any[] {
  const definitions = definitionsOf(bo);
  return (definitions?.get?.('rootElements') ?? definitions?.rootElements ?? [])
    .filter((root: any) => root?.$type === 'bpmn:Collaboration' || root?.$type === 'bpmn:Choreography')
    .flatMap((holder: any) => holder.get?.('participants') ?? holder.participants ?? []);
}

/** The participant's kind from its extension: the type it carries and, among that type's kinds, the one its attribute picks (its default when unset). */
export function participantKind(participant: any): ParticipantKind | undefined {
  const kinds = participantKinds();
  for (const ext of participant?.extensionElements?.values ?? []) {
    const ofType = kinds.filter((kind) => kind.type.toLowerCase() === String(ext?.$type ?? '').toLowerCase());
    if (ofType.length === 0) continue;
    const attribute = ofType[0].attribute;
    if (!attribute) return ofType[0];
    const value = String(getAttribute(participant, attribute) ?? '');
    return ofType.find((kind) => kind.value === value) ?? ofType[0];
  }
  return undefined;
}

/**
 * Type a participant that only takes bands as the kind `id` names, or untype it (`''`). The edit is reported on
 * `element`, the task whose band shows the participant, since the participant has no shape.
 */
export function setParticipantKind(element: any, modeling: any, model: { create(type: string, properties?: Record<string, unknown>): any }, participant: any, id: string): void {
  if (!participant || (participantKind(participant)?.id ?? '') === id) return;
  if (!id) {
    modeling.updateModdleProperties(element, participant, { extensionElements: undefined });
    return;
  }
  const kind = participantKinds().find((candidate) => candidate.id === id);
  if (!kind) return;
  const current = (participant.extensionElements?.values ?? []).find((ext: any) => String(ext?.$type ?? '').toLowerCase() === kind.type.toLowerCase());
  if (current && kind.attribute) { // the same extension, another of its kinds
    modeling.updateModdleProperties(element, current, { [kind.attribute]: kind.value });
    return;
  }
  const wrapper = model.create(kind.type, kind.attribute ? { [kind.attribute]: kind.value } : {});
  const container = model.create('bpmn:ExtensionElements', { values: [wrapper] });
  wrapper.$parent = container;
  container.$parent = participant;
  modeling.updateModdleProperties(element, participant, { extensionElements: container });
}

/**
 * Put an existing participant (a pool, or an actor) on a band, or clear the band with `null`: a typed task then
 * falls back to the pool it sits in, a plain task gets a fresh placeholder. The initiator follows a replaced band.
 */
export function selectBandParticipant(element: any, modeling: any, bpmnFactory: any, band: 'top' | 'bottom', participant: any | null): void {
  const bo = element.businessObject;
  if (isTypedChoreography(bo)) {
    const replaced = actorOf(bo);
    if (replaced === participant) return;
    modeling.updateModdleProperties(element, bo, { participantRef: participant ? [participant] : [], initiatingParticipantRef: undefined });
    dropIfOrphan(element, modeling, replaced);
    return;
  }
  const [top, bottom] = ensureChoreographyParticipants(element, modeling, bpmnFactory);
  const replaced = band === 'top' ? top : bottom;
  if (replaced === participant) return;
  let next = participant;
  if (!next) {
    next = bpmnFactory.create('bpmn:Participant', { name: band === 'top' ? DEFAULT_TOP : DEFAULT_BOTTOM });
    declareParticipants(element, modeling, bpmnFactory, [next]);
  }
  const refs = band === 'top' ? [next, bottom] : [top, next];
  const initiating = bo.get('initiatingParticipantRef');
  modeling.updateModdleProperties(element, bo, {
    participantRef: refs,
    initiatingParticipantRef: initiating === replaced ? next : initiating,
  });
  dropIfOrphan(element, modeling, replaced);
}
