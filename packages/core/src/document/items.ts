import type { ModdleWriter } from '@core/element';
import { getProperty, type ModdleElement } from '@core/element/moddle';

/** What an edit of the document writes through: each write recorded, new elements given ids no other holds. */
export interface DocumentWriter extends ModdleWriter {
  create(type: string, properties?: Record<string, unknown>): ModdleElement;
  /** `base`, else `base_2`, `base_3`…: the first id the document does not hold. */
  freeId(base: string): string;
}

/** A structureRef is free text but an id is an NCName, so other characters become underscores. */
const idPart = (structureRef: string): string => structureRef.replace(/[^\w.-]/g, '_');

/** The item definition of `structureRef` (`behaverse:Trial`, `xsd:integer`), made as a root of the document on first use. */
export function ensureItemDefinition(writer: DocumentWriter, definitions: ModdleElement, structureRef: string): ModdleElement {
  const roots: ModdleElement[] = definitions.rootElements ?? [];
  const existing = roots.find((root) => root?.$type === 'bpmn:ItemDefinition' && root.structureRef === structureRef);
  if (existing) return existing;
  const itemDefinition = writer.create('bpmn:ItemDefinition', { id: writer.freeId(`ItemDefinition_${idPart(structureRef)}`), structureRef });
  itemDefinition.$parent = definitions;
  writer.set(definitions, { rootElements: [...roots, itemDefinition] });
  return itemDefinition;
}

/** What a property or a data object holds: the item definition of `structureRef`; '' says nothing of it. */
export function setItemSubject(writer: DocumentWriter, definitions: ModdleElement, element: ModdleElement, structureRef: string): void {
  writer.set(element, { itemSubjectRef: structureRef ? ensureItemDefinition(writer, definitions, structureRef) : undefined });
}

/**
 * What a message flow carries: a `bpmn:Message` root per item definition, made on first use and dropped with its last
 * flow; '' names no message. The item definition the message left behind may still type a property, so it stays.
 */
export function setMessageItem(writer: DocumentWriter, definitions: ModdleElement, flow: ModdleElement, structureRef: string): void {
  const before: ModdleElement[] = definitions.rootElements ?? [];
  const previous = getProperty(flow, 'messageRef');
  const itemDefinition = structureRef ? ensureItemDefinition(writer, definitions, structureRef) : undefined;
  let message = itemDefinition && (definitions.rootElements ?? []).find((root: ModdleElement) => root?.$type === 'bpmn:Message' && root.itemRef === itemDefinition);
  if (itemDefinition && !message) {
    message = writer.create('bpmn:Message', { id: writer.freeId(`Message_${idPart(structureRef)}`), itemRef: itemDefinition });
    message.$parent = definitions;
    writer.set(definitions, { rootElements: [...definitions.rootElements, message] });
  }
  if (message === previous) return;
  writer.set(flow, { messageRef: message });
  const stillCarried = previous && before.some((root) => (root?.messageFlows ?? []).some(
    (other: ModdleElement) => other !== flow && getProperty(other, 'messageRef') === previous,
  ));
  if (previous && !stillCarried) {
    writer.set(definitions, { rootElements: (definitions.rootElements ?? []).filter((root: ModdleElement) => root !== previous) });
  }
}
