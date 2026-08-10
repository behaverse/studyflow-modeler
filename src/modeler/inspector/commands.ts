import { modelingUpdater } from '@/modeler/bpmn/modeling';
import { setAttribute, setExpressionLanguage, toBusinessObject } from '@/core/element';
import { ensureChoreographyParticipants } from '@/modeler/bpmn/choreographyParticipants';
import { definitionsOf, getStateProperties, nextPropertyId } from '@/modeler/inspector/stateProperties';
import type { Modeler } from '@/modeler/bpmn/types';

export type UpdateAttributeCommand = {
  type: 'UpdateAttribute';
  element: any;
  attributeName: string;
  value: any;
};

export function runUpdateAttribute(modeler: Modeler, command: UpdateAttributeCommand): void {
  setAttribute(command.element, command.attributeName, command.value, modelingUpdater(modeler.get('modeling')));
}


export type UpdateExpressionLanguageCommand = {
  type: 'UpdateExpressionLanguage';
  element: any;
  attributeName: string;
  language: string | undefined;
};

export function runUpdateExpressionLanguage(
  modeler: Modeler,
  command: UpdateExpressionLanguageCommand,
): void {
  setExpressionLanguage(command.element, command.attributeName, command.language, modelingUpdater(modeler.get('modeling')));
}


export type UpdateChoreographyParticipantsCommand = {
  type: 'UpdateChoreographyParticipants';
  element: any;
} & (
  | { field: 'top' | 'bottom'; value: string }
  | { field: 'initiator'; value: 'top' | 'bottom' }
);

export function runUpdateChoreographyParticipants(
  modeler: Modeler,
  command: UpdateChoreographyParticipantsCommand,
): void {
  const modeling = modeler.get('modeling');
  const [top, bottom] = ensureChoreographyParticipants(command.element, modeling, modeler.get('bpmnFactory'));

  if (command.field === 'initiator') {
    const bo = toBusinessObject(command.element);
    const next = command.value === 'bottom' ? bottom : top;
    if (bo.get?.('initiatingParticipantRef') !== next) {
      modeling.updateModdleProperties(command.element, bo, { initiatingParticipantRef: next });
    }
    return;
  }

  const participant = command.field === 'top' ? top : bottom;
  modeling.updateModdleProperties(command.element, participant, { name: command.value });
}


export type UpdateTransformationCommand = {
  type: 'UpdateTransformation';
  element: any;
} & (
  | { field: 'body'; value: string }
  | { field: 'language'; value: string | undefined }
);

export function runUpdateTransformation(modeler: Modeler, command: UpdateTransformationCommand): void {
  const modeling = modeler.get('modeling');
  const association = toBusinessObject(command.element);
  const expression = association.get?.('transformation') ?? association.transformation;

  if (command.field === 'language') {
    if (expression) modeling.updateModdleProperties(command.element, expression, { language: command.value || undefined });
    return;
  }

  const body = command.value.trim();
  if (!body) {
    modeling.updateModdleProperties(command.element, association, { transformation: undefined });
  } else if (expression) {
    modeling.updateModdleProperties(command.element, expression, { body });
  } else {
    const created = modeler.get('moddle').create('bpmn:FormalExpression', { body });
    created.$parent = association;
    modeling.updateModdleProperties(command.element, association, { transformation: created });
  }
}


export type UpdateLoopCharacteristicsCommand = {
  type: 'UpdateLoopCharacteristics';
  element: any;
  loopType: string | null;
  properties?: Record<string, any>;
};

export function runUpdateLoopCharacteristics(modeler: Modeler, command: UpdateLoopCharacteristicsCommand): void {
  const { element, loopType, properties = {} } = command;
  const modeling = modeler.get('modeling');
  const businessObject = toBusinessObject(element);
  const existing = businessObject?.loopCharacteristics;

  if (!loopType) {
    if (existing) modeling.updateProperties(element, { loopCharacteristics: undefined });
    return;
  }

  if (existing && existing.$type === loopType) {
    if (Object.keys(properties).length > 0) {
      modeling.updateModdleProperties(element, existing, coerceExpressions(modeler, properties, existing));
    }
    return;
  }

  const loopCharacteristics = modeler.get('bpmnFactory').create(loopType, {});
  loopCharacteristics.$parent = businessObject;
  const coerced = coerceExpressions(modeler, properties, loopCharacteristics);
  for (const [name, value] of Object.entries(coerced)) loopCharacteristics.set(name, value);
  modeling.updateProperties(element, { loopCharacteristics });
}

/** Wrap a string `loopCondition` into BPMN's concrete `xsi:type` expression form (empty clears it). */
function coerceExpressions(modeler: Modeler, properties: Record<string, any>, parent: any): Record<string, any> {
  if (!('loopCondition' in properties)) return properties;
  const raw = properties.loopCondition;
  if (typeof raw !== 'string' || raw === '') return { ...properties, loopCondition: undefined };
  const expression = modeler.get('bpmnFactory').create('bpmn:FormalExpression', { body: raw });
  expression.$parent = parent;
  return { ...properties, loopCondition: expression };
}


export type UpdateStatePropertiesCommand = {
  type: 'UpdateStateProperties';
  element: any;
} & (
  | { action: 'add' }
  | { action: 'remove'; propertyId: string }
  | { action: 'rename'; propertyId: string; name: string }
  | { action: 'retype'; propertyId: string; itemType: string }
);

function findDefinitions(modeler: Modeler, businessObject: any): any {
  return definitionsOf(businessObject)
    ?? modeler.get('canvas').getRootElement()?.businessObject?.$parent
    ?? null;
}

function ensureItemDefinition(modeler: Modeler, element: any, businessObject: any, structureRef: string): any {
  const definitions = findDefinitions(modeler, businessObject);
  if (!definitions) return null;

  const rootElements: any[] = definitions.rootElements ?? [];
  const existing = rootElements.find(
    (re) => re?.$type === 'bpmn:ItemDefinition' && re.structureRef === structureRef,
  );
  if (existing) return existing;

  const taken = new Set(rootElements.map((re) => re?.id));
  // A structureRef is free text but an id is an NCName, so non-NCName chars become underscores.
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

export function runUpdateStateProperties(modeler: Modeler, command: UpdateStatePropertiesCommand): void {
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

  if (!command.itemType) {
    modeling.updateModdleProperties(element, target.moddleElement, { itemSubjectRef: undefined });
    return;
  }
  const itemDefinition = ensureItemDefinition(modeler, element, businessObject, command.itemType);
  if (itemDefinition) {
    modeling.updateModdleProperties(element, target.moddleElement, { itemSubjectRef: itemDefinition });
  }
}


export type UpdateDataBindingCommand = {
  type: 'UpdateDataBinding';
  element: any;
} & (
  | { action: 'bind'; direction: 'input' | 'output'; propertyId: string }
  | { action: 'unbind'; direction: 'input' | 'output'; associationId: string }
  | { action: 'set-binding'; direction: 'input' | 'output'; associationId: string; value: string }
);

const LIST_BY_DIRECTION = {
  input: 'dataInputAssociations',
  output: 'dataOutputAssociations',
} as const;

const TYPE_BY_DIRECTION = {
  input: 'bpmn:DataInputAssociation',
  output: 'bpmn:DataOutputAssociation',
} as const;

function associationsOf(businessObject: any, direction: 'input' | 'output'): any[] {
  const listName = LIST_BY_DIRECTION[direction];
  return businessObject?.get?.(listName) ?? businessObject?.[listName] ?? [];
}

function findPropertyInScope(businessObject: any, propertyId: string): any {
  let node = businessObject;
  while (node) {
    const properties = node.get?.('properties') ?? node.properties ?? [];
    const hit = (Array.isArray(properties) ? properties : []).find(
      (p: any) => p?.$type === 'bpmn:Property' && p.id === propertyId,
    );
    if (hit) return hit;
    node = node.$parent;
  }
  return null;
}

function nextAssociationId(
  moddle: any,
  businessObject: any,
  propertyId: string,
  direction: 'input' | 'output',
): string {
  const local = new Set(
    [...associationsOf(businessObject, 'input'), ...associationsOf(businessObject, 'output')]
      .map((a: any) => a?.id),
  );
  const taken = (id: string) => local.has(id) || Boolean(moddle?.ids?.assigned?.(id));

  const base = `${direction === 'input' ? 'DataInput' : 'DataOutput'}_${propertyId}`;
  let id = base;
  for (let n = 2; taken(id); n += 1) id = `${base}_${n}`;
  return id;
}

export function runUpdateDataBinding(modeler: Modeler, command: UpdateDataBindingCommand): void {
  const { element, direction } = command;
  const modeling = modeler.get('modeling');
  const businessObject = toBusinessObject(element);
  if (!businessObject) return;

  const listName = LIST_BY_DIRECTION[direction];
  const existing = associationsOf(businessObject, direction);

  if (command.action === 'bind') {
    const property = findPropertyInScope(businessObject, command.propertyId);
    if (!property) return;

    const association = modeler.get('bpmnFactory').create(TYPE_BY_DIRECTION[direction], {
      id: nextAssociationId(modeler.get('moddle'), businessObject, command.propertyId, direction),
      ...(direction === 'input' ? { sourceRef: [property] } : { targetRef: property }),
    });
    association.$parent = businessObject;
    modeling.updateModdleProperties(element, businessObject, {
      [listName]: [...existing, association],
    });
    return;
  }

  const target = existing.find((a: any) => a?.id === command.associationId);
  if (!target) return;

  if (command.action === 'unbind') {
    modeling.updateModdleProperties(element, businessObject, {
      [listName]: existing.filter((a: any) => a !== target),
    });
    return;
  }

  const value = command.value || undefined;
  const expression = target.get?.('transformation') ?? target.transformation;
  if (!value) {
    modeling.updateModdleProperties(element, target, { transformation: undefined });
  } else if (expression) {
    modeling.updateModdleProperties(element, expression, { body: value });
  } else {
    const moddle = modeler.get('moddle');
    const created = moddle.create('bpmn:FormalExpression', { body: value });
    created.$parent = target;
    modeling.updateModdleProperties(element, target, { transformation: created });
  }
}
