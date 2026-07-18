import { toBusinessObject } from '@/core/extensions';

export type UpdateLoopCharacteristicsCommand = {
  type: 'update-loop-characteristics';
  element: any;
  /** Loop child to carry (`bpmn:StandardLoopCharacteristics` or
   *  `bpmn:MultiInstanceLoopCharacteristics`); null removes the child. */
  loopType: string | null;
  /** Fields to write on the child, e.g. `isSequential` (multi-instance).
   *  Standard-loop children are only ever imported, never authored. */
  properties?: Record<string, any>;
};

/**
 * Add, remove, switch, or edit an activity's `loopCharacteristics` child.
 * All writes go through `modeling`, so each dispatch is one undo step and
 * the canvas marker re-renders from the model.
 */
export function runUpdateLoopCharacteristics(modeler: any, command: UpdateLoopCharacteristicsCommand): void {
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

/** `loopCondition` is BPMN's own expression element; a string from the Loop
 *  tab wraps into the concrete `xsi:type` form (empty clears the child). */
function coerceExpressions(modeler: any, properties: Record<string, any>, parent: any): Record<string, any> {
  if (!('loopCondition' in properties)) return properties;
  const raw = properties.loopCondition;
  if (typeof raw !== 'string' || raw === '') return { ...properties, loopCondition: undefined };
  const expression = modeler.get('bpmnFactory').create('bpmn:FormalExpression', { body: raw });
  expression.$parent = parent;
  return { ...properties, loopCondition: expression };
}
