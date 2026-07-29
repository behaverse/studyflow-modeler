import { toBusinessObject } from '@/core/extensions';
import {
  definitionsOf,
  getStateProperties,
  nextPropertyId,
} from '@/modeler/models/inspector/stateProperties';

export type UpdateStatePropertiesCommand = {
  type: 'update-state-properties';
  element: any;
} & (
  | { action: 'add' }
  | { action: 'remove'; propertyId: string }
  | { action: 'rename'; propertyId: string; name: string }
  | { action: 'retype'; propertyId: string; itemType: string }
);

/** The `bpmn:Definitions` root, reached from the element's own tree, or from
 *  the canvas when the element is not yet attached to one. */
function findDefinitions(modeler: any, businessObject: any): any {
  return definitionsOf(businessObject)
    ?? modeler.get('canvas').getRootElement()?.businessObject?.$parent
    ?? null;
}

/**
 * The `bpmn:ItemDefinition` for `structureRef`, reused when one already
 * exists. Item definitions are shared type declarations, so a study with ten
 * integer properties carries one integer item definition, not ten.
 *
 * Creating one is its own undo step and is deliberately not reversed when a
 * property is retyped or removed: an unreferenced item definition is a valid,
 * inert type declaration, and reusing it keeps ids stable across edits.
 */
function ensureItemDefinition(modeler: any, element: any, businessObject: any, structureRef: string): any {
  const definitions = findDefinitions(modeler, businessObject);
  if (!definitions) return null;

  const rootElements: any[] = definitions.rootElements ?? [];
  const existing = rootElements.find(
    (re) => re?.$type === 'bpmn:ItemDefinition' && re.structureRef === structureRef,
  );
  if (existing) return existing;

  const taken = new Set(rootElements.map((re) => re?.id));
  // A structureRef is free text (`list[str]`, `dict[str, int]`); an id is an
  // NCName, so anything outside it becomes an underscore.
  const base = `ItemDefinition_${structureRef.replace(/[^\w.-]/g, '_')}`;
  let id = base;
  for (let i = 2; taken.has(id); i += 1) id = `${base}_${i}`;

  const itemDefinition = modeler.get('bpmnFactory').create('bpmn:ItemDefinition', { id, structureRef });
  itemDefinition.$parent = definitions;
  modeler.get('modeling').updateModdleProperties(element, definitions, {
    rootElements: [...rootElements, itemDefinition],
  });
  return itemDefinition;
}

/**
 * Add, remove, rename, or retype one `bpmn:Property` on the selected element.
 * Every write goes through `modeling`, so each dispatch is one undo step and
 * the change lands in the serialized file immediately.
 */
export function runUpdateStateProperties(modeler: any, command: UpdateStatePropertiesCommand): void {
  const { element } = command;
  const modeling = modeler.get('modeling');
  const businessObject = toBusinessObject(element);
  if (!businessObject) return;

  const current = getStateProperties(element);
  const moddleElements = current.map((p) => p.moddleElement);

  if (command.action === 'add') {
    const id = nextPropertyId(element);
    const property = modeler.get('bpmnFactory').create('bpmn:Property', { id, name: '' });
    property.$parent = businessObject;
    modeling.updateModdleProperties(element, businessObject, {
      properties: [...moddleElements, property],
    });
    return;
  }

  const target = current.find((p) => p.id === command.propertyId);
  if (!target) return;

  if (command.action === 'remove') {
    modeling.updateModdleProperties(element, businessObject, {
      properties: moddleElements.filter((p) => p !== target.moddleElement),
    });
    return;
  }

  if (command.action === 'rename') {
    modeling.updateModdleProperties(element, target.moddleElement, { name: command.name });
    return;
  }

  // retype: '' clears the reference, leaving the property untyped.
  if (!command.itemType) {
    modeling.updateModdleProperties(element, target.moddleElement, { itemSubjectRef: undefined });
    return;
  }
  const itemDefinition = ensureItemDefinition(modeler, element, businessObject, command.itemType);
  if (itemDefinition) {
    modeling.updateModdleProperties(element, target.moddleElement, { itemSubjectRef: itemDefinition });
  }
}
