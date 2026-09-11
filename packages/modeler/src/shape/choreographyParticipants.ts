import { ensureChoreographyParticipants, mintParticipant } from '@canvas/index.ts';
import { DEFAULT_BOTTOM, DEFAULT_TOP, actorOf, isTypedChoreography } from '@core/document';
import { definitionsOf, getAttribute, toBusinessObject, type AttributeUpdater } from '@core/element';
import { getCatalog } from '@core/notation';

/* Who takes a choreography task's bands, as inspector edits: the participants themselves are minted by the
   canvas (`ensureChoreographyParticipants`, `mintParticipant`), and each edit here is recorded through `updater`. */

/** What mints participant ids: the editor's `model.ids`. */
type Ids = { nextPrefixed(prefix: string): string };

/** A new actor for a typed task, named as typed, put on its band in place of a drawn pool that must keep its name. */
export function nameNewActor(element: any, updater: AttributeUpdater, ids: Ids, name: string): void {
  const actor = mintParticipant(toBusinessObject(element) as any, name, ids);
  if (actor) selectBandParticipant(element, updater, ids, 'bottom', actor);
}

/** Whether another choreography task in the file still shows `participant` on a band. */
function referencedElsewhere(definitions: any, participant: any, except: any): boolean {
  const visit = (container: any): boolean => (container?.get?.('flowElements') ?? container?.flowElements ?? [])
    .some((el: any) => (el !== except && (el.get?.('participantRef') ?? el.participantRef ?? []).includes(participant)) || visit(el));
  return (definitions?.get?.('rootElements') ?? definitions?.rootElements ?? []).some(visit);
}

/** Drop a participant that only ever took bands and takes none any more; a pool on the canvas stays. */
function dropIfOrphan(element: any, updater: AttributeUpdater, participant: any): void {
  if (!participant || participant.processRef) return;
  const definitions = definitionsOf(participant);
  if (referencedElsewhere(definitions, participant, element.businessObject)) return;
  const holder = participant.$parent;
  const held: any[] = holder?.get?.('participants') ?? holder?.participants ?? [];
  if (!holder || !held.includes(participant)) return;
  updater.updateModdleProperties(element, holder, { participants: held.filter((p: any) => p !== participant) });
}

export function swapChoreographyInitiator(element: any, updater: AttributeUpdater, ids: Ids): void {
  const bo: any = toBusinessObject(element);
  const pair = ensureChoreographyParticipants(bo, ids);
  if (!pair) return;
  const [top, bottom] = pair;
  updater.updateModdleProperties(element, bo, {
    initiatingParticipantRef: bo.get('initiatingParticipantRef') === top ? bottom : top,
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
export function setParticipantKind(element: any, updater: AttributeUpdater, model: { create(type: string, properties?: Record<string, unknown>): any }, participant: any, id: string): void {
  if (!participant || (participantKind(participant)?.id ?? '') === id) return;
  if (!id) {
    updater.updateModdleProperties(element, participant, { extensionElements: undefined });
    return;
  }
  const kind = participantKinds().find((candidate) => candidate.id === id);
  if (!kind) return;
  const current = (participant.extensionElements?.values ?? []).find((ext: any) => String(ext?.$type ?? '').toLowerCase() === kind.type.toLowerCase());
  if (current && kind.attribute) { // the same extension, another of its kinds
    updater.updateModdleProperties(element, current, { [kind.attribute]: kind.value });
    return;
  }
  const wrapper = model.create(kind.type, kind.attribute ? { [kind.attribute]: kind.value } : {});
  const container = model.create('bpmn:ExtensionElements', { values: [wrapper] });
  wrapper.$parent = container;
  container.$parent = participant;
  updater.updateModdleProperties(element, participant, { extensionElements: container });
}

/**
 * Put an existing participant (a pool, or an actor) on a band, or clear the band with `null`: a typed task then
 * falls back to the pool it sits in, a plain task gets a fresh placeholder. The initiator follows a replaced band.
 */
export function selectBandParticipant(element: any, updater: AttributeUpdater, ids: Ids, band: 'top' | 'bottom', participant: any | null): void {
  const bo: any = toBusinessObject(element);
  if (isTypedChoreography(bo)) {
    const replaced = actorOf(bo);
    if (replaced === participant) return;
    updater.updateModdleProperties(element, bo, { participantRef: participant ? [participant] : [], initiatingParticipantRef: undefined });
    dropIfOrphan(element, updater, replaced);
    return;
  }
  const pair = ensureChoreographyParticipants(bo, ids);
  if (!pair) return;
  const [top, bottom] = pair;
  const replaced = band === 'top' ? top : bottom;
  if (replaced === participant) return;
  const next = participant ?? mintParticipant(bo, band === 'top' ? DEFAULT_TOP : DEFAULT_BOTTOM, ids);
  if (!next) return;
  const refs = band === 'top' ? [next, bottom] : [top, next];
  const initiating = bo.get('initiatingParticipantRef');
  updater.updateModdleProperties(element, bo, {
    participantRef: refs,
    initiatingParticipantRef: initiating === replaced ? next : initiating,
  });
  dropIfOrphan(element, updater, replaced);
}
