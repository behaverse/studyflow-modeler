import { is } from 'bpmn-js/lib/util/ModelUtil';
import { toBusinessObject } from '@behaverse/studyflow-core/element';

export type LoopKind = 'none' | 'loop' | 'parallel' | 'sequential';

export const LOOP_STATE_BY_KIND: Record<
  Exclude<LoopKind, 'none'>,
  { loopType: string; properties?: Record<string, any> }
> = {
  'loop': { loopType: 'bpmn:StandardLoopCharacteristics' },
  'parallel': {
    loopType: 'bpmn:MultiInstanceLoopCharacteristics',
    properties: { isSequential: undefined },
  },
  'sequential': {
    loopType: 'bpmn:MultiInstanceLoopCharacteristics',
    properties: { isSequential: true },
  },
};

/** Only activities may carry `loopCharacteristics` in BPMN 2.0. */
export function supportsLoopCharacteristics(element: any): boolean {
  return !!element && is(element, 'bpmn:Activity');
}

export function getLoopCharacteristics(element: any): any {
  return toBusinessObject(element)?.loopCharacteristics ?? null;
}

export function loopKindOf(element: any): LoopKind {
  const loopCharacteristics = getLoopCharacteristics(element);
  if (!loopCharacteristics) return 'none';
  if (is(loopCharacteristics, 'bpmn:MultiInstanceLoopCharacteristics')) {
    return loopCharacteristics.get('isSequential') === true ? 'sequential' : 'parallel';
  }
  return 'loop';
}
