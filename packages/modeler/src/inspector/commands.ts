import { setParticipantKind } from '@core/model/choreography';
import { isElement, type Element, type StudyModel, type Value } from '@core/model/index';
import { setItemSubjectIn, setMessageItemIn } from '@core/model/items';
import { isReservedStateKey } from '@core/model/state';
import { declaredProperties, nextPropertyId, scopeOf } from '@modeler/inspector/stateProperties';
import type { Editor } from '@modeler/editor/port';

/* The inspector's edits. Each names the element it is about (`element`, as the inspector showed it) and changes the
   study model `study.revise` hands it, where every element is found again by id. */

export type UpdateAttributeCommand = {
  type: 'UpdateAttribute';
  element: { id?: unknown };
  attributeName: string;
  value: any;
};

export function runUpdateAttribute(modeler: Editor, command: UpdateAttributeCommand): void {
  modeler.study.set({ id: String(command.element.id), attribute: command.attributeName, value: command.value });
}

export type SelectElementCommand = {
  type: 'SelectElement';
  id: string;
};

/** Selects the element with `id`, when the canvas holds it. */
export function runSelectElement(modeler: Editor, command: SelectElementCommand): void {
  modeler.canvas.select(command.id);
}


export type UpdateChoreographyParticipantsCommand = {
  type: 'UpdateChoreographyParticipants';
  element: Element;
} & (
  | { field: 'top' | 'bottom'; value: string }
  | { field: 'top' | 'bottom'; select: Element | null }
  | { field: 'initiator'; value: 'top' | 'bottom' }
);

/** Who takes a band, by the study's `bands`, as an AI says it with the tool of that name. */
export function runUpdateChoreographyParticipants(
  modeler: Editor,
  command: UpdateChoreographyParticipantsCommand,
): void {
  const id = String(command.element.id);
  if (command.field === 'initiator') modeler.study.bands({ id, initiator: command.value });
  else if ('select' in command) modeler.study.bands({ id, [command.field]: command.select ? { participant: String(command.select.id) } : null });
  else modeler.study.bands({ id, [command.field]: { name: command.value } });
}


export type UpdateParticipantKindCommand = {
  type: 'UpdateParticipantKind';
  /** The choreography task whose band shows the participant; the edit is reported on it. */
  element: Element;
  participant: Element;
  /** A kind's id, or `''` to untype. */
  kind: string;
};

export function runUpdateParticipantKind(modeler: Editor, command: UpdateParticipantKindCommand): void {
  modeler.study.revise(String(command.element.id), (_task, model) => setParticipantKind(model, model.get(String(command.participant.id)), command.kind));
}


export type UpdateTransformationCommand = {
  type: 'UpdateTransformation';
  element: Element;
  field: 'body';
  value: string;
};

export function runUpdateTransformation(modeler: Editor, command: UpdateTransformationCommand): void {
  // Committed on blur, so the stored expression can be the trimmed one.
  modeler.study.revise(String(command.element.id), (association) => writeTransformation(association, command.value.trim()), 'transformation');
}

/** A data association's transformation set to `body` as given, its language kept; an empty one removes it. */
function writeTransformation(association: Element, body: string): void {
  const expression = association.transformation;
  if (!body) delete association.transformation;
  else if (isElement(expression)) expression.body = body;
  else association.transformation = body;
}


export type UpdateLoopCharacteristicsCommand = {
  type: 'UpdateLoopCharacteristics';
  element: Element;
  loopType: string | null;
  properties?: Record<string, any>;
};

export function runUpdateLoopCharacteristics(modeler: Editor, command: UpdateLoopCharacteristicsCommand): void {
  const { element, loopType, properties = {} } = command;
  const existing = element.loopCharacteristics;
  const same = loopType && isElement(existing) && existing.type === loopType;

  modeler.study.revise(String(element.id), (activity) => {
    if (!loopType) {
      delete activity.loopCharacteristics;
      return;
    }
    const current = activity.loopCharacteristics;
    const loop: Element = isElement(current) && current.type === loopType ? current : { type: loopType };
    for (const [name, value] of Object.entries(properties)) {
      // An empty condition clears it; `undefined` takes a property out.
      if (value === undefined || (name === 'loopCondition' && value === '')) delete loop[name];
      else loop[name] = value as Value;
    }
    activity.loopCharacteristics = loop;
  // Typing into a field of the loop it has is one step; a change of kind is a step of its own.
  }, same && Object.keys(properties).length > 0 ? `loop:${Object.keys(properties).sort().join(',')}` : undefined);
}


export type UpdateStatePropertiesCommand = {
  type: 'UpdateStateProperties';
  element: Element;
} & (
  | { action: 'add' }
  | { action: 'remove'; propertyId: string }
  | { action: 'rename'; propertyId: string; name: string }
  | { action: 'retype'; propertyId: string; itemType: string }
);

export function runUpdateStateProperties(modeler: Editor, command: UpdateStatePropertiesCommand): void {
  modeler.study.revise(String(command.element.id), (element, model, ids) => {
    const scope = scopeOf(model, element);
    const current = declaredProperties(model, element);
    if (command.action === 'add') {
      const id = nextPropertyId((candidate) => model.get(candidate) !== undefined);
      ids.free(id);
      scope.properties = [...(Array.isArray(scope.properties) ? scope.properties : []), { type: 'bpmn:Property', id, name: '' }];
      return;
    }

    const target = current.find((p) => p.id === command.propertyId);
    if (!target) return;

    if (command.action === 'remove') {
      scope.properties = (Array.isArray(scope.properties) ? scope.properties : []).filter((p) => p !== target);
      return;
    }

    if (command.action === 'rename') {
      // `_`-prefixed keys are the runner's (`_meta`); the rename is refused and the previous name stays.
      if (isReservedStateKey(command.name)) return;
      target.name = command.name;
      return;
    }

    setItemSubjectIn(model, ids, target, command.itemType);
  }, command.action === 'rename' ? `property:${command.propertyId}` : undefined);
}


export type UpdateMessageCommand = {
  type: 'UpdateMessage';
  /** The message flow. */
  element: Element;
  /** What the flow carries, as an item definition's `structureRef`; '' names no message. */
  structureRef: string;
};

/** What a message flow carries (core's `setMessageItemIn`). */
export function runUpdateMessage(modeler: Editor, command: UpdateMessageCommand): void {
  modeler.study.revise(String(command.element.id), (flow, model, ids) => setMessageItemIn(model, ids, flow, command.structureRef.trim()));
}


export type UpdateDataBindingCommand = {
  type: 'UpdateDataBinding';
  element: Element;
} & (
  | { action: 'bind'; direction: 'input' | 'output'; propertyId: string }
  | { action: 'unbind'; direction: 'input' | 'output'; associationId: string }
  | { action: 'set-binding'; direction: 'input' | 'output'; associationId: string; value: string }
);

const LIST = { input: 'dataInputAssociations', output: 'dataOutputAssociations' } as const;
const ASSOCIATION = { input: 'bpmn:DataInputAssociation', output: 'bpmn:DataOutputAssociation' } as const;

/** The property `propertyId` names, declared by `element` or a container around it. */
function findPropertyInScope(model: StudyModel, element: Element, propertyId: string): Element | undefined {
  for (let node: Element | undefined = element; node; node = model.parentOf(node)) {
    const hit = (Array.isArray(node.properties) ? node.properties : [])
      .find((p): p is Element => isElement(p) && model.host(p) === 'bpmn:Property' && p.id === propertyId);
    if (hit) return hit;
  }
  return undefined;
}

export function runUpdateDataBinding(modeler: Editor, command: UpdateDataBindingCommand): void {
  const { direction } = command;
  const listName = LIST[direction];

  modeler.study.revise(String(command.element.id), (element, model, ids) => {
    const existing = (Array.isArray(element[listName]) ? element[listName] as Value[] : []).filter(isElement);
    if (command.action === 'bind') {
      const property = findPropertyInScope(model, element, command.propertyId);
      if (!property) return;
      const association: Element = {
        type: ASSOCIATION[direction],
        id: ids.free(`${direction === 'input' ? 'DataInput' : 'DataOutput'}_${command.propertyId}`),
        ...(direction === 'input' ? { sourceRef: [property.id!] } : { targetRef: property.id! }),
      };
      element[listName] = [...existing, association];
      return;
    }

    const target = existing.find((a) => a.id === command.associationId);
    if (!target) return;

    if (command.action === 'unbind') {
      element[listName] = existing.filter((a) => a !== target);
      return;
    }

    // Written on every keystroke of a controlled field: stored as typed, or a space would vanish as it is typed.
    writeTransformation(target, command.value);
  }, command.action === 'set-binding' ? `binding:${command.associationId}` : undefined);
}

