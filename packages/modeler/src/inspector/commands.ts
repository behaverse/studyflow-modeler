import { setAttribute, setExpressionLanguage, toBusinessObject } from '@core/element';
import { ensureChoreographyParticipants } from '@modeler/shape/choreographyParticipants';
import { definitionsOf, getStateProperties, nextPropertyId } from '@modeler/inspector/stateProperties';
import type { Editor } from '@modeler/editor/port';

export type UpdateAttributeCommand = {
  type: 'UpdateAttribute';
  element: any;
  attributeName: string;
  value: any;
};

export function runUpdateAttribute(modeler: Editor, command: UpdateAttributeCommand): void {
  setAttribute(command.element, command.attributeName, command.value, modeler.mutate);
}


export type UpdateExpressionLanguageCommand = {
  type: 'UpdateExpressionLanguage';
  element: any;
  attributeName: string;
  language: string | undefined;
};

export function runUpdateExpressionLanguage(
  modeler: Editor,
  command: UpdateExpressionLanguageCommand,
): void {
  setExpressionLanguage(command.element, command.attributeName, command.language, modeler.mutate);
}


export type UpdateChoreographyParticipantsCommand = {
  type: 'UpdateChoreographyParticipants';
  element: any;
} & (
  | { field: 'top' | 'bottom'; value: string }
  | { field: 'initiator'; value: 'top' | 'bottom' }
);

export function runUpdateChoreographyParticipants(
  modeler: Editor,
  command: UpdateChoreographyParticipantsCommand,
): void {
  const { mutate, model } = modeler;
  // `mutate` covers the `modeling` surface the helper uses; the factory shim maps `create` onto the facade.
  const [top, bottom] = ensureChoreographyParticipants(command.element, mutate, { create: model.createBusinessObject });

  if (command.field === 'initiator') {
    const bo = toBusinessObject(command.element);
    const next = command.value === 'bottom' ? bottom : top;
    if (bo.get?.('initiatingParticipantRef') !== next) {
      mutate.updateModdleProperties(command.element, bo, { initiatingParticipantRef: next });
    }
    return;
  }

  const participant = command.field === 'top' ? top : bottom;
  mutate.updateModdleProperties(command.element, participant, { name: command.value });
}


export type UpdateTransformationCommand = {
  type: 'UpdateTransformation';
  element: any;
} & (
  | { field: 'body'; value: string }
  | { field: 'language'; value: string | undefined }
);

export function runUpdateTransformation(modeler: Editor, command: UpdateTransformationCommand): void {
  const { mutate, model } = modeler;
  const association = toBusinessObject(command.element);
  const expression = association.get?.('transformation') ?? association.transformation;

  if (command.field === 'language') {
    if (expression) mutate.updateModdleProperties(command.element, expression, { language: command.value || undefined });
    return;
  }

  const body = command.value.trim();
  if (!body) {
    mutate.updateModdleProperties(command.element, association, { transformation: undefined });
  } else if (expression) {
    mutate.updateModdleProperties(command.element, expression, { body });
  } else {
    const created = model.create('bpmn:FormalExpression', { body });
    created.$parent = association;
    mutate.updateModdleProperties(command.element, association, { transformation: created });
  }
}


export type UpdateLoopCharacteristicsCommand = {
  type: 'UpdateLoopCharacteristics';
  element: any;
  loopType: string | null;
  properties?: Record<string, any>;
};

export function runUpdateLoopCharacteristics(modeler: Editor, command: UpdateLoopCharacteristicsCommand): void {
  const { element, loopType, properties = {} } = command;
  const businessObject = toBusinessObject(element);
  const existing = businessObject?.loopCharacteristics;

  if (!loopType) {
    if (existing) modeler.mutate.updateProperties(element, { loopCharacteristics: undefined });
    return;
  }

  if (existing && existing.$type === loopType) {
    if (Object.keys(properties).length > 0) {
      modeler.mutate.updateModdleProperties(element, existing, coerceExpressions(modeler, properties, existing));
    }
    return;
  }

  const loopCharacteristics = modeler.model.createBusinessObject(loopType, {});
  loopCharacteristics.$parent = businessObject;
  const coerced = coerceExpressions(modeler, properties, loopCharacteristics);
  for (const [name, value] of Object.entries(coerced)) loopCharacteristics.set(name, value);
  modeler.mutate.updateProperties(element, { loopCharacteristics });
}

/** Wrap a string `loopCondition` into BPMN's concrete `xsi:type` expression form (empty clears it). */
function coerceExpressions(editor: Editor, properties: Record<string, any>, parent: any): Record<string, any> {
  if (!('loopCondition' in properties)) return properties;
  const raw = properties.loopCondition;
  if (typeof raw !== 'string' || raw === '') return { ...properties, loopCondition: undefined };
  const expression = editor.model.createBusinessObject('bpmn:FormalExpression', { body: raw });
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

function findDefinitions(editor: Editor, businessObject: any): any {
  return definitionsOf(businessObject)
    ?? editor.elements.root()?.businessObject?.$parent
    ?? null;
}

function ensureItemDefinition(editor: Editor, element: any, businessObject: any, structureRef: string): any {
  const definitions = findDefinitions(editor, businessObject);
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

  const itemDefinition = editor.model.createBusinessObject('bpmn:ItemDefinition', { id, structureRef });
  itemDefinition.$parent = definitions;
  editor.mutate.updateModdleProperties(element, definitions, {
    rootElements: [...rootElements, itemDefinition],
  });
  return itemDefinition;
}

export function runUpdateStateProperties(modeler: Editor, command: UpdateStatePropertiesCommand): void {
  const { element } = command;
  const businessObject = toBusinessObject(element);
  if (!businessObject) return;

  const current = getStateProperties(element);
  const moddleElements = current.map((p) => p.moddleElement);

  if (command.action === 'add') {
    const id = nextPropertyId(element);
    const property = modeler.model.createBusinessObject('bpmn:Property', { id, name: '' });
    property.$parent = businessObject;
    modeler.mutate.updateModdleProperties(element, businessObject, {
      properties: [...moddleElements, property],
    });
    return;
  }

  const target = current.find((p) => p.id === command.propertyId);
  if (!target) return;

  if (command.action === 'remove') {
    modeler.mutate.updateModdleProperties(element, businessObject, {
      properties: moddleElements.filter((p) => p !== target.moddleElement),
    });
    return;
  }

  if (command.action === 'rename') {
    modeler.mutate.updateModdleProperties(element, target.moddleElement, { name: command.name });
    return;
  }

  if (!command.itemType) {
    modeler.mutate.updateModdleProperties(element, target.moddleElement, { itemSubjectRef: undefined });
    return;
  }
  const itemDefinition = ensureItemDefinition(modeler, element, businessObject, command.itemType);
  if (itemDefinition) {
    modeler.mutate.updateModdleProperties(element, target.moddleElement, { itemSubjectRef: itemDefinition });
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
  model: Editor['model'],
  businessObject: any,
  propertyId: string,
  direction: 'input' | 'output',
): string {
  const local = new Set(
    [...associationsOf(businessObject, 'input'), ...associationsOf(businessObject, 'output')]
      .map((a: any) => a?.id),
  );
  const taken = (id: string) => local.has(id) || Boolean(model.ids.assigned(id));

  const base = `${direction === 'input' ? 'DataInput' : 'DataOutput'}_${propertyId}`;
  let id = base;
  for (let n = 2; taken(id); n += 1) id = `${base}_${n}`;
  return id;
}

export function runUpdateDataBinding(modeler: Editor, command: UpdateDataBindingCommand): void {
  const { element, direction } = command;
  const { mutate, model } = modeler;
  const businessObject = toBusinessObject(element);
  if (!businessObject) return;

  const listName = LIST_BY_DIRECTION[direction];
  const existing = associationsOf(businessObject, direction);

  if (command.action === 'bind') {
    const property = findPropertyInScope(businessObject, command.propertyId);
    if (!property) return;

    const association = model.createBusinessObject(TYPE_BY_DIRECTION[direction], {
      id: nextAssociationId(model, businessObject, command.propertyId, direction),
      ...(direction === 'input' ? { sourceRef: [property] } : { targetRef: property }),
    });
    association.$parent = businessObject;
    mutate.updateModdleProperties(element, businessObject, {
      [listName]: [...existing, association],
    });
    return;
  }

  const target = existing.find((a: any) => a?.id === command.associationId);
  if (!target) return;

  if (command.action === 'unbind') {
    mutate.updateModdleProperties(element, businessObject, {
      [listName]: existing.filter((a: any) => a !== target),
    });
    return;
  }

  const value = command.value || undefined;
  const expression = target.get?.('transformation') ?? target.transformation;
  if (!value) {
    mutate.updateModdleProperties(element, target, { transformation: undefined });
  } else if (expression) {
    mutate.updateModdleProperties(element, expression, { body: value });
  } else {
    const created = model.create('bpmn:FormalExpression', { body: value });
    created.$parent = target;
    mutate.updateModdleProperties(element, target, { transformation: created });
  }
}
