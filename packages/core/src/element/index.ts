import { getCatalog, hasCatalog } from '@core/notation';
import {
  CHECKLIST_SPEC,
  definitionsOf,
  getAttributeSpec,
  getRawAttribute,
  isExtensionPrefix,
  toBusinessObject,
} from '@core/element/attributes';
import { StudyflowElement, type ModdleWriter } from '@core/element/handle';

export {
  CHECKLIST_SPEC,
  definitionsOf,
  getAttributeSpec,
  getRawAttribute,
  isExtensionPrefix,
  toBusinessObject,
  StudyflowElement,
  type ModdleWriter,
};
export type { ModdleElement } from '@core/element/moddle';

/** The association a data shape feeding an activity is. */
export const DATA_INPUT_ASSOCIATION = 'bpmn:DataInputAssociation';
/** The association an activity producing a data shape is. */
export const DATA_OUTPUT_ASSOCIATION = 'bpmn:DataOutputAssociation';

/** Which way the data flows, relative to the activity. */
export type DataAssociationDirection = 'input' | 'output';

/** Whether `type` is one of the two data-association types. */
export function isDataAssociationType(type: string): boolean {
  return type === DATA_INPUT_ASSOCIATION || type === DATA_OUTPUT_ASSOCIATION;
}

/** The association type for a direction. */
export function typeForDirection(direction: DataAssociationDirection): string {
  return direction === 'input' ? DATA_INPUT_ASSOCIATION : DATA_OUTPUT_ASSOCIATION;
}

/** The list property on the activity a direction's associations are filed under. */
export function associationPropertyFor(direction: DataAssociationDirection): string {
  return direction === 'input' ? 'dataInputAssociations' : 'dataOutputAssociations';
}

/** The `$type` of an event's first definition (`'bpmn:TimerEventDefinition'`), or `undefined` for a plain event. */
export function eventDefinitionTypeOf(bo: any): string | undefined {
  const defs = bo?.eventDefinitions;
  const first = Array.isArray(defs) ? defs[0] : undefined;
  return first?.$type ?? first?.type;
}

/** Derived, not stored; shared by the canvas marker and the NIDM/Artemis exporters so it cannot drift. */
export function isDataOperationActivity(elementOrBO: any): boolean {
  if (!elementOrBO) return false;
  const extensionType = getExtensionType(elementOrBO);
  if (extensionType && hasCatalog() && getCatalog().hasRole(extensionType, 'instrument')) return false;
  const implementation = getAttribute(elementOrBO, 'implementation');
  return typeof implementation === 'string' && implementation.trim() !== '';
}

export function getDefaults(typeName: string): Record<string, any> {
  return { ...getCatalog().defaultsOf(typeName) };
}

export function getExtensionType(elementOrBO: any): string | undefined {
  return StudyflowElement.fromBusinessObject(elementOrBO).extensionType;
}

export function getAttribute(elementOrBO: any, attributeName: string): any {
  return StudyflowElement.fromBusinessObject(elementOrBO).getAttribute(attributeName);
}

export function getExpressionLanguage(element: any, attributeName: string): string | undefined {
  return StudyflowElement.fromBusinessObject(element).getExpressionLanguage(attributeName);
}

export function setExpressionLanguage(
  element: any,
  attributeName: string,
  language: string | undefined,
  writer?: ModdleWriter,
): void {
  StudyflowElement.fromBusinessObject(element, writer).setExpressionLanguage(attributeName, language);
}

export function setAttribute(element: any, attributeName: string, value: any, writer?: ModdleWriter): void {
  StudyflowElement.fromBusinessObject(element, writer).setAttribute(attributeName, value);
}
