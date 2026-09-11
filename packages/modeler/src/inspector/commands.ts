import { isReservedStateKey } from '@core/document';
import { definitionsOf, setAttribute, setExpressionLanguage, toBusinessObject } from '@core/element';
import { associationPropertyFor, ensureChoreographyParticipants, typeForDirection } from '@canvas/index.ts';
import { nameNewActor, selectBandParticipant, setParticipantKind } from '@modeler/shape/choreographyParticipants';
import { isTypedChoreography } from '@core/document';
import { getStateProperties, nextPropertyId, scopeOf } from '@modeler/inspector/stateProperties';
import type { Editor } from '@modeler/editor/port';

export type UpdateAttributeCommand = {
  type: 'UpdateAttribute';
  element: any;
  attributeName: string;
  value: any;
};

export function runUpdateAttribute(modeler: Editor, command: UpdateAttributeCommand): void {
  setAttribute(command.element, command.attributeName, command.value, modeler.canvas);
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
  setExpressionLanguage(command.element, command.attributeName, command.language, modeler.canvas);
}


export type UpdateChoreographyParticipantsCommand = {
  type: 'UpdateChoreographyParticipants';
  element: any;
} & (
  | { field: 'top' | 'bottom'; value: string }
  | { field: 'top' | 'bottom'; select: any | null }
  | { field: 'initiator'; value: 'top' | 'bottom' }
);

export function runUpdateChoreographyParticipants(
  modeler: Editor,
  command: UpdateChoreographyParticipantsCommand,
): void {
  const { canvas, model } = modeler;
  const bo: any = toBusinessObject(command.element);
  const pair = ensureChoreographyParticipants(bo, model.ids);
  if (!pair) return;
  const [top, bottom] = pair;

  if (command.field === 'initiator') {
    // Written even when it stands: a pair minted just now is an edit to record.
    canvas.updateModdleProperties(command.element, bo, { initiatingParticipantRef: command.value === 'bottom' ? bottom : top });
    return;
  }

  if ('select' in command) {
    selectBandParticipant(command.element, canvas, model.ids, command.field, command.select);
    return;
  }
  const participant = command.field === 'top' ? top : bottom;
  // A typed task's actor that is a drawn pool keeps its name: typing another names a new actor for this task.
  if (isTypedChoreography(bo) && participant?.processRef) {
    nameNewActor(command.element, canvas, model.ids, command.value);
    return;
  }
  canvas.updateModdleProperties(command.element, participant, { name: command.value });
}


export type UpdateParticipantKindCommand = {
  type: 'UpdateParticipantKind';
  /** The choreography task whose band shows the participant; the edit is reported on it. */
  element: any;
  participant: any;
  /** A kind's id, or `''` to untype. */
  kind: string;
};

export function runUpdateParticipantKind(modeler: Editor, command: UpdateParticipantKindCommand): void {
  setParticipantKind(command.element, modeler.canvas, modeler.model, command.participant, command.kind);
}


export type UpdateTransformationCommand = {
  type: 'UpdateTransformation';
  element: any;
} & (
  | { field: 'body'; value: string }
  | { field: 'language'; value: string | undefined }
);

export function runUpdateTransformation(modeler: Editor, command: UpdateTransformationCommand): void {
  const association = toBusinessObject(command.element);
  if (command.field === 'language') {
    const expression = association.get?.('transformation') ?? association.transformation;
    if (expression) modeler.canvas.updateModdleProperties(command.element, expression, { language: command.value || undefined });
    return;
  }
  // Committed on blur, so the stored expression can be the trimmed one.
  writeTransformation(modeler, command.element, association, command.value.trim());
}

/** A data association's transformation set to `body` as given, its expression reused; an empty one removes it. */
function writeTransformation(modeler: Editor, element: any, association: any, body: string): void {
  const expression = association.get?.('transformation') ?? association.transformation;
  if (!body) {
    modeler.canvas.updateModdleProperties(element, association, { transformation: undefined });
  } else if (expression) {
    modeler.canvas.updateModdleProperties(element, expression, { body });
  } else {
    const created = modeler.model.create('bpmn:FormalExpression', { body });
    created.$parent = association;
    modeler.canvas.updateModdleProperties(element, association, { transformation: created });
  }
}

/** `base`, else `base_2`, `base_3`…: the first id `taken` refuses. */
function uniqueId(base: string, taken: (id: string) => boolean): string {
  let id = base;
  for (let n = 2; taken(id); n += 1) id = `${base}_${n}`;
  return id;
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
    if (existing) modeler.canvas.updateProperties(element, { loopCharacteristics: undefined });
    return;
  }

  if (existing && existing.$type === loopType) {
    if (Object.keys(properties).length > 0) {
      modeler.canvas.updateModdleProperties(element, existing, coerceExpressions(modeler, properties, existing));
    }
    return;
  }

  const loopCharacteristics = modeler.model.createBusinessObject(loopType, {});
  loopCharacteristics.$parent = businessObject;
  const coerced = coerceExpressions(modeler, properties, loopCharacteristics);
  for (const [name, value] of Object.entries(coerced)) loopCharacteristics.set(name, value);
  modeler.canvas.updateProperties(element, { loopCharacteristics });
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
    ?? editor.canvas.getRoot()?.businessObject?.$parent
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
  const id = uniqueId(`ItemDefinition_${structureRef.replace(/[^\w.-]/g, '_')}`, (candidate) => taken.has(candidate));

  const itemDefinition = editor.model.createBusinessObject('bpmn:ItemDefinition', { id, structureRef });
  itemDefinition.$parent = definitions;
  editor.canvas.updateModdleProperties(element, definitions, {
    rootElements: [...rootElements, itemDefinition],
  });
  return itemDefinition;
}

export function runUpdateStateProperties(modeler: Editor, command: UpdateStatePropertiesCommand): void {
  const { element } = command;
  const businessObject = scopeOf(element);
  if (!businessObject) return;

  const current = getStateProperties(element);
  const moddleElements = current.map((p) => p.moddleElement);

  if (command.action === 'add') {
    const id = nextPropertyId(element);
    const property = modeler.model.createBusinessObject('bpmn:Property', { id, name: '' });
    property.$parent = businessObject;
    modeler.canvas.updateModdleProperties(element, businessObject, {
      properties: [...moddleElements, property],
    });
    return;
  }

  const target = current.find((p) => p.id === command.propertyId);
  if (!target) return;

  if (command.action === 'remove') {
    modeler.canvas.updateModdleProperties(element, businessObject, {
      properties: moddleElements.filter((p) => p !== target.moddleElement),
    });
    return;
  }

  if (command.action === 'rename') {
    // `_`-prefixed keys are the runner's (`_meta`); the rename is refused and the previous name stays.
    if (isReservedStateKey(command.name)) return;
    modeler.canvas.updateModdleProperties(element, target.moddleElement, { name: command.name });
    return;
  }

  if (!command.itemType) {
    modeler.canvas.updateModdleProperties(element, target.moddleElement, { itemSubjectRef: undefined });
    return;
  }
  const itemDefinition = ensureItemDefinition(modeler, element, businessObject, command.itemType);
  if (itemDefinition) {
    modeler.canvas.updateModdleProperties(element, target.moddleElement, { itemSubjectRef: itemDefinition });
  }
}


export type UpdateMessageCommand = {
  type: 'UpdateMessage';
  /** The message flow. */
  element: any;
  /** What the flow carries, as an item definition's `structureRef`; '' names no message. */
  structureRef: string;
};

/** A message flow's `messageRef`: a `bpmn:Message` root per item definition, made on first use and dropped with its last flow. */
export function runUpdateMessage(modeler: Editor, command: UpdateMessageCommand): void {
  const { element } = command;
  const flow = toBusinessObject(element);
  const definitions = findDefinitions(modeler, flow);
  if (!flow || !definitions) return;
  const rootElements: any[] = definitions.rootElements ?? [];
  const previous = flow.get?.('messageRef') ?? flow.messageRef;
  const structureRef = command.structureRef.trim();

  const itemDefinition = structureRef ? ensureItemDefinition(modeler, element, flow, structureRef) : null;
  let message = itemDefinition
    ? (definitions.rootElements ?? []).find((re: any) => re?.$type === 'bpmn:Message' && re.itemRef === itemDefinition)
    : undefined;
  if (itemDefinition && !message) {
    const taken = new Set((definitions.rootElements ?? []).map((re: any) => re?.id));
    const id = uniqueId(`Message_${structureRef.replace(/[^\w.-]/g, '_')}`, (candidate) => taken.has(candidate));
    message = modeler.model.createBusinessObject('bpmn:Message', { id, itemRef: itemDefinition });
    message.$parent = definitions;
    modeler.canvas.updateModdleProperties(element, definitions, { rootElements: [...definitions.rootElements, message] });
  }
  if (message === previous) return;
  modeler.canvas.updateModdleProperties(element, flow, { messageRef: message });

  // The message the flow left behind goes when no other flow carries it; its item definition may still type a property.
  const stillCarried = previous && rootElements.some((root: any) => (root?.messageFlows ?? []).some(
    (other: any) => other !== flow && (other.get?.('messageRef') ?? other.messageRef) === previous,
  ));
  if (previous && !stillCarried) {
    modeler.canvas.updateModdleProperties(element, definitions, {
      rootElements: (definitions.rootElements ?? []).filter((re: any) => re !== previous),
    });
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

function associationsOf(businessObject: any, direction: 'input' | 'output'): any[] {
  const listName = associationPropertyFor(direction);
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
  return uniqueId(
    `${direction === 'input' ? 'DataInput' : 'DataOutput'}_${propertyId}`,
    (id) => local.has(id) || Boolean(model.ids.assigned(id)),
  );
}

export function runUpdateDataBinding(modeler: Editor, command: UpdateDataBindingCommand): void {
  const { element, direction } = command;
  const { canvas: mutate, model } = modeler;
  const businessObject = toBusinessObject(element);
  if (!businessObject) return;

  const listName = associationPropertyFor(direction);
  const existing = associationsOf(businessObject, direction);

  if (command.action === 'bind') {
    const property = findPropertyInScope(businessObject, command.propertyId);
    if (!property) return;

    const association = model.createBusinessObject(typeForDirection(direction), {
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

  // Written on every keystroke of a controlled field: stored as typed, or a space would vanish as it is typed.
  writeTransformation(modeler, element, target, command.value);
}
