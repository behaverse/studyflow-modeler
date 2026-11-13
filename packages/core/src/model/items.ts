/**
 * The item definition a property, a data object or a message flow holds (`cognitive:Trial`, `xsd:integer`): a root of
 * the study made on first use, which a message flow carries through a `bpmn:Message` of its own.
 */
import { idOf, isElement, type Element, type StudyModel } from '@core/model/index';

/** Mints ids for the elements an edit adds; each is an id the study does not hold yet. */
export type Ids = {
  /** `prefix` and a counter (`Participant_0003`). */
  next(prefix: string): string;
  /** `base`, else `base_2`, `base_3`…. */
  free(base: string): string;
};

/** A structureRef is free text but an id is an NCName, so other characters become underscores. */
const idPart = (structureRef: string): string => structureRef.replace(/[^\w.-]/g, '_');

/** The item definition of `structureRef`, made as a root of the study on first use. */
export function ensureItemDefinitionIn(model: StudyModel, ids: Ids, structureRef: string): Element {
  const existing = model.study.roots.find((root) => model.host(root) === 'bpmn:ItemDefinition' && root.structureRef === structureRef);
  if (existing) return existing;
  const itemDefinition: Element = { type: 'bpmn:ItemDefinition', id: ids.free(`ItemDefinition_${idPart(structureRef)}`), structureRef };
  model.study.roots.push(itemDefinition);
  model.reindex();
  return itemDefinition;
}

/** Sets the item a property or a data object holds: the item definition of `structureRef`; '' unsets it. */
export function setItemSubjectIn(model: StudyModel, ids: Ids, element: Element, structureRef: string): void {
  if (structureRef) element.itemSubjectRef = ensureItemDefinitionIn(model, ids, structureRef).id;
  else delete element.itemSubjectRef;
}

/**
 * Sets the message a flow carries: a `bpmn:Message` root per item definition, made on first use and dropped with its
 * last flow; '' names no message. The item definition a dropped message leaves behind may still type a property, so
 * it stays.
 */
export function setMessageItemIn(model: StudyModel, ids: Ids, flow: Element, structureRef: string): void {
  const { roots } = model.study;
  const previous = idOf(flow.messageRef);
  const itemDefinition = structureRef ? ensureItemDefinitionIn(model, ids, structureRef) : undefined;
  let message = itemDefinition && roots.find((root) => model.host(root) === 'bpmn:Message' && idOf(root.itemRef) === itemDefinition.id);
  if (itemDefinition && !message) {
    message = { type: 'bpmn:Message', id: ids.free(`Message_${idPart(structureRef)}`), itemRef: itemDefinition.id };
    roots.push(message);
    model.reindex();
  }
  if ((message?.id ?? null) === previous) return;
  if (message) flow.messageRef = message.id;
  else delete flow.messageRef;
  const stillCarried = roots.some((root) => (Array.isArray(root.messageFlows) ? root.messageFlows : [])
    .some((other) => isElement(other) && other !== flow && idOf(other.messageRef) === previous));
  if (previous && !stillCarried) {
    model.study.roots = roots.filter((root) => root.id !== previous);
    model.reindex();
  }
}
