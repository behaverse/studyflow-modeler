/** What an element of a type is, by its type's name: the data associations, an event's definition, a schema's defaults and attributes. */
import type { Element } from '@core/model/index';
import { getCatalog } from '@core/notation';

export { getAttributeSpec, getAttributeSpecs } from '@core/element/attributes';

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

/** The list property on the activity a direction's associations are filed under. */
export function associationPropertyFor(direction: DataAssociationDirection): string {
  return direction === 'input' ? 'dataInputAssociations' : 'dataOutputAssociations';
}

/** The type of an event's first definition (`'bpmn:TimerEventDefinition'`), or `undefined` for a plain event. */
export function eventDefinitionTypeOf(event: Partial<Element> | undefined): string | undefined {
  const definitions = event?.eventDefinitions;
  const first = Array.isArray(definitions) ? definitions[0] : undefined;
  return first && typeof first === 'object' && !Array.isArray(first) && typeof first.type === 'string' ? first.type : undefined;
}

/** The defaults a schema type declares, by their qualified names (`cognitive:restDuration`). */
export function getDefaults(typeName: string): Record<string, any> {
  return { ...getCatalog().defaultsOf(typeName) };
}
