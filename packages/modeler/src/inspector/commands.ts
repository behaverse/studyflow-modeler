import { isReservedStateKey } from '@core/document';
import { associationPropertyFor, definitionsOf, setExpressionLanguage, toBusinessObject, typeForDirection } from '@core/element';
import { isPool, nameNewActor, selectBandParticipant, setParticipantKind } from '@modeler/shape/choreographyParticipants';
import { ensureChoreographyParticipants, isTypedChoreography } from '@core/document';
import { getStateProperties, nextPropertyId, scopeOf } from '@modeler/inspector/stateProperties';
import type { StudyWriter } from '@canvas/index.ts';
import type { Editor } from '@modeler/editor/port';

export type UpdateAttributeCommand = {
  type: 'UpdateAttribute';
  element: any;
  attributeName: string;
  value: any;
};

export function runUpdateAttribute(modeler: Editor, command: UpdateAttributeCommand): void {
  modeler.study.set({ id: command.element.id, attribute: command.attributeName, value: command.value });
}

export type SelectElementCommand = {
  type: 'SelectElement';
  id: string;
};

/** Selects the element with `id`, when the canvas holds it. */
export function runSelectElement(modeler: Editor, command: SelectElementCommand): void {
  modeler.canvas.select(command.id);
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
  const { element, attributeName, language } = command;
  modeler.study.edit(element.id, (writer) => setExpressionLanguage(element, attributeName, language, writer));
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
  const { element } = command;
  modeler.study.edit(element.id, (writer) => {
    const bo: any = toBusinessObject(element);
    const pair = ensureChoreographyParticipants(bo, writer.ids);
    if (!pair) return;
    const [top, bottom] = pair;

    if (command.field === 'initiator') {
      // Written even when it stands: a pair minted just now is an edit to record.
      writer.set(bo, { initiatingParticipantRef: command.value === 'bottom' ? bottom : top });
      return;
    }

    if ('select' in command) {
      selectBandParticipant(element, writer, modeler.study, command.field, command.select);
      return;
    }
    const participant = command.field === 'top' ? top : bottom;
    // A typed task's actor that is a drawn pool keeps its name: typing another names a new actor for this task.
    if (isTypedChoreography(bo) && isPool(participant, modeler.study)) {
      nameNewActor(element, writer, modeler.study, command.value);
      return;
    }
    writer.set(participant, { name: command.value });
  });
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
  modeler.study.edit(command.element.id, (writer) => setParticipantKind(writer, command.participant, command.kind));
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
  modeler.study.edit(command.element.id, (writer) => {
    if (command.field === 'language') {
      const expression = association.get?.('transformation') ?? association.transformation;
      if (expression) writer.set(expression, { language: command.value || undefined });
      return;
    }
    // Committed on blur, so the stored expression can be the trimmed one.
    writeTransformation(writer, association, command.value.trim());
  });
}

/** A data association's transformation set to `body` as given, its expression reused; an empty one removes it. */
function writeTransformation(writer: StudyWriter, association: any, body: string): void {
  const expression = association.get?.('transformation') ?? association.transformation;
  if (!body) {
    writer.set(association, { transformation: undefined });
  } else if (expression) {
    writer.set(expression, { body });
  } else {
    const created = writer.create('bpmn:FormalExpression', { body });
    created.$parent = association;
    writer.set(association, { transformation: created });
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

  modeler.study.edit(element.id, (writer) => {
    if (!loopType) {
      if (existing) writer.set(businessObject, { loopCharacteristics: undefined });
      return;
    }

    if (existing && existing.$type === loopType) {
      if (Object.keys(properties).length > 0) writer.set(existing, coerceExpressions(writer, properties, existing));
      return;
    }

    const loopCharacteristics: any = writer.create(loopType);
    loopCharacteristics.$parent = businessObject;
    const coerced = coerceExpressions(writer, properties, loopCharacteristics);
    for (const [name, value] of Object.entries(coerced)) loopCharacteristics.set(name, value);
    writer.set(businessObject, { loopCharacteristics });
  });
}

/** Wrap a string `loopCondition` into BPMN's concrete `xsi:type` expression form (empty clears it). */
function coerceExpressions(writer: StudyWriter, properties: Record<string, any>, parent: any): Record<string, any> {
  if (!('loopCondition' in properties)) return properties;
  const raw = properties.loopCondition;
  if (typeof raw !== 'string' || raw === '') return { ...properties, loopCondition: undefined };
  const expression = writer.create('bpmn:FormalExpression', { body: raw });
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
  return definitionsOf(businessObject) ?? editor.study.definitions;
}

function ensureItemDefinition(writer: StudyWriter, definitions: any, structureRef: string): any {
  const rootElements: any[] = definitions.rootElements ?? [];
  const existing = rootElements.find(
    (re) => re?.$type === 'bpmn:ItemDefinition' && re.structureRef === structureRef,
  );
  if (existing) return existing;

  // A structureRef is free text but an id is an NCName, so non-NCName chars become underscores.
  const id = writer.freeId(`ItemDefinition_${structureRef.replace(/[^\w.-]/g, '_')}`);
  const itemDefinition = writer.create('bpmn:ItemDefinition', { id, structureRef });
  itemDefinition.$parent = definitions;
  writer.set(definitions, { rootElements: [...rootElements, itemDefinition] });
  return itemDefinition;
}

export function runUpdateStateProperties(modeler: Editor, command: UpdateStatePropertiesCommand): void {
  const { element } = command;
  const businessObject = scopeOf(element);
  if (!businessObject) return;

  const current = getStateProperties(element);
  const moddleElements = current.map((p) => p.moddleElement);

  modeler.study.edit(element.id, (writer) => {
    if (command.action === 'add') {
      const id = nextPropertyId((candidate) => writer.ids.assigned(candidate));
      const property = writer.create('bpmn:Property', { id, name: '' });
      property.$parent = businessObject;
      writer.set(businessObject, { properties: [...moddleElements, property] });
      return;
    }

    const target = current.find((p) => p.id === command.propertyId);
    if (!target) return;

    if (command.action === 'remove') {
      writer.set(businessObject, { properties: moddleElements.filter((p) => p !== target.moddleElement) });
      return;
    }

    if (command.action === 'rename') {
      // `_`-prefixed keys are the runner's (`_meta`); the rename is refused and the previous name stays.
      if (isReservedStateKey(command.name)) return;
      writer.set(target.moddleElement, { name: command.name });
      return;
    }

    if (!command.itemType) {
      writer.set(target.moddleElement, { itemSubjectRef: undefined });
      return;
    }
    const itemDefinition = ensureItemDefinition(writer, findDefinitions(modeler, businessObject), command.itemType);
    writer.set(target.moddleElement, { itemSubjectRef: itemDefinition });
  });
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
  if (!flow) return;
  const definitions = findDefinitions(modeler, flow);
  const rootElements: any[] = definitions.rootElements ?? [];
  const previous = flow.get?.('messageRef') ?? flow.messageRef;
  const structureRef = command.structureRef.trim();

  modeler.study.edit(element.id, (writer) => {
    const itemDefinition = structureRef ? ensureItemDefinition(writer, definitions, structureRef) : null;
    let message = itemDefinition
      ? (definitions.rootElements ?? []).find((re: any) => re?.$type === 'bpmn:Message' && re.itemRef === itemDefinition)
      : undefined;
    if (itemDefinition && !message) {
      const id = writer.freeId(`Message_${structureRef.replace(/[^\w.-]/g, '_')}`);
      message = writer.create('bpmn:Message', { id, itemRef: itemDefinition });
      message.$parent = definitions;
      writer.set(definitions, { rootElements: [...definitions.rootElements, message] });
    }
    if (message === previous) return;
    writer.set(flow, { messageRef: message });

    // The message the flow left behind goes when no other flow carries it; its item definition may still type a property.
    const stillCarried = previous && rootElements.some((root: any) => (root?.messageFlows ?? []).some(
      (other: any) => other !== flow && (other.get?.('messageRef') ?? other.messageRef) === previous,
    ));
    if (previous && !stillCarried) {
      writer.set(definitions, { rootElements: (definitions.rootElements ?? []).filter((re: any) => re !== previous) });
    }
  });
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

export function runUpdateDataBinding(modeler: Editor, command: UpdateDataBindingCommand): void {
  const { element, direction } = command;
  const businessObject = toBusinessObject(element);
  if (!businessObject) return;

  const listName = associationPropertyFor(direction);
  const existing = associationsOf(businessObject, direction);

  modeler.study.edit(element.id, (writer) => {
    if (command.action === 'bind') {
      const property = findPropertyInScope(businessObject, command.propertyId);
      if (!property) return;

      const association = writer.create(typeForDirection(direction), {
        id: writer.freeId(`${direction === 'input' ? 'DataInput' : 'DataOutput'}_${command.propertyId}`),
        ...(direction === 'input' ? { sourceRef: [property] } : { targetRef: property }),
      });
      association.$parent = businessObject;
      writer.set(businessObject, { [listName]: [...existing, association] });
      return;
    }

    const target = existing.find((a: any) => a?.id === command.associationId);
    if (!target) return;

    if (command.action === 'unbind') {
      writer.set(businessObject, { [listName]: existing.filter((a: any) => a !== target) });
      return;
    }

    // Written on every keystroke of a controlled field: stored as typed, or a space would vanish as it is typed.
    writeTransformation(writer, target, command.value);
  });
}
