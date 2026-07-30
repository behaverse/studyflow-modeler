import { toBusinessObject } from '@/core/extensions';

export type UpdateDataBindingCommand = {
  type: 'update-data-binding';
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

/** Resolve a property by id anywhere up the element's container chain. */
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

/**
 * Readable, collision-free id, named for the BPMN type it creates
 * (`bpmn:DataInputAssociation` -> `DataInput_…`), as the shipped examples are.
 *
 * BPMN ids are scoped to the whole document, not to the activity: a diagram
 * that already associates `Features` somewhere else has claimed
 * `DataInput_Features`,
 * and reusing it makes the two collapse into one on the next parse — the
 * binding would look right in the editor and be gone from the saved file. So
 * ask the model's own id registry, which tracks every id it imported or
 * issued, and only fall back to a local scan if it is unavailable.
 */
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

/**
 * Bind, unbind, or re-bind one declared variable on this step.
 *
 * A data association to a drawn data element is created by drawing it; a property has no
 * shape, so there is nothing to draw to and this is where its binding is made.
 * Both produce the same BPMN construct — a data association on the activity —
 * so a diagram authored either way serializes identically.
 *
 * All writes go through `modeling`, so each dispatch is one undo step.
 */
export function runUpdateDataBinding(modeler: any, command: UpdateDataBindingCommand): void {
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

  // set-binding: an input names the callable's parameter (a plain string); an
  // output narrows the return value through BPMN's own `transformation`
  // expression element, so an empty value clears the child rather than
  // storing an empty expression.
  if (direction === 'input') {
    modeling.updateModdleProperties(element, target, { parameter: command.value || undefined });
    return;
  }

  if (!command.value) {
    modeling.updateModdleProperties(element, target, { transformation: undefined });
    return;
  }
  const expression = modeler.get('bpmnFactory').create('bpmn:FormalExpression', { body: command.value });
  expression.$parent = target;
  modeling.updateModdleProperties(element, target, { transformation: expression });
}
