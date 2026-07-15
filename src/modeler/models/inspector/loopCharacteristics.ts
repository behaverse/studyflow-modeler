import { is } from 'bpmn-js/lib/util/ModelUtil';
import { toBusinessObject } from '@/core/extensions';

/**
 * Loop state of an activity, read from BPMN's own `loopCharacteristics`
 * child (the construct behind the ↻ / ∥ / ≡ canvas markers). There is no
 * schema trait for this — see the note in exec.moddle.yaml next to
 * `exec:LoopCondition`.
 */

export type LoopKind = 'none' | 'standard' | 'multi-instance';

export const LOOP_TYPE_BY_KIND: Record<Exclude<LoopKind, 'none'>, string> = {
  'standard': 'bpmn:StandardLoopCharacteristics',
  'multi-instance': 'bpmn:MultiInstanceLoopCharacteristics',
};

/** Only activities may carry `loopCharacteristics` in BPMN 2.0. */
export function supportsLoopCharacteristics(element: any): boolean {
  return !!element && is(element, 'bpmn:Activity');
}

/** The element's `loopCharacteristics` child, or null. */
export function getLoopCharacteristics(element: any): any {
  return toBusinessObject(element)?.loopCharacteristics ?? null;
}

/** Which loop marker the element currently carries. */
export function loopKindOf(element: any): LoopKind {
  const loopCharacteristics = getLoopCharacteristics(element);
  if (!loopCharacteristics) return 'none';
  return is(loopCharacteristics, 'bpmn:MultiInstanceLoopCharacteristics')
    ? 'multi-instance'
    : 'standard';
}
