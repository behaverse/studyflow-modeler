import { toBusinessObject } from '@/core/extensions';

export type UpdateLoopCharacteristicsCommand = {
  type: 'update-loop-characteristics';
  element: any;
  /** Loop child to carry (`bpmn:StandardLoopCharacteristics` or
   *  `bpmn:MultiInstanceLoopCharacteristics`); null removes the child. */
  loopType: string | null;
  /** Fields to write on the child: `loopCondition`, `loopMaximum`,
   *  `testBefore` (standard) or `isSequential` (multi-instance). */
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
      modeling.updateModdleProperties(element, existing, properties);
    }
    return;
  }

  const loopCharacteristics = modeler.get('bpmnFactory').create(loopType, properties);
  loopCharacteristics.$parent = businessObject;
  modeling.updateProperties(element, { loopCharacteristics });
}
