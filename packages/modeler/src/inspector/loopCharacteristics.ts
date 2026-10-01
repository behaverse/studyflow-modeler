import { isElement, type Element, type StudyModel } from '@core/model/index';

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
export function supportsLoopCharacteristics(model: StudyModel, element: Element | undefined): boolean {
  return !!element && model.isA(element, 'bpmn:Activity');
}

export function getLoopCharacteristics(element: Element | undefined): Element | null {
  const loop = element?.loopCharacteristics;
  return isElement(loop) ? loop : null;
}

export function loopKindOf(element: Element | undefined): LoopKind {
  const loopCharacteristics = getLoopCharacteristics(element);
  if (!loopCharacteristics) return 'none';
  if (loopCharacteristics.type === 'bpmn:MultiInstanceLoopCharacteristics') {
    return loopCharacteristics.isSequential === true ? 'sequential' : 'parallel';
  }
  return 'loop';
}
