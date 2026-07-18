import { is } from 'bpmn-js/lib/util/ModelUtil';
import { toBusinessObject } from '@/core/extensions';

/**
 * Loop state of an activity, read from BPMN's own `loopCharacteristics`
 * child (the construct behind the ↻ / ∥ / ≡ canvas markers). There is no
 * schema trait for the child itself; the four kinds are exactly BPMN's own
 * states — no child, a standard loop (↻, one activity retried in place), or
 * a multi-instance fan-out, parallel (∥) or sequential (≡). A repeat that
 * spans several steps is drawn control flow instead: a conditioned
 * back-edge through a gateway, bounded by `state.visits.<gateway-id>`.
 */

export type LoopKind = 'none' | 'loop' | 'parallel' | 'sequential';

/** Child type and fields behind each authored kind. */
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

/** The element's `loopCharacteristics` child, or null. */
export function getLoopCharacteristics(element: any): any {
  return toBusinessObject(element)?.loopCharacteristics ?? null;
}

/** Which loop marker the element currently carries. */
export function loopKindOf(element: any): LoopKind {
  const loopCharacteristics = getLoopCharacteristics(element);
  if (!loopCharacteristics) return 'none';
  if (is(loopCharacteristics, 'bpmn:MultiInstanceLoopCharacteristics')) {
    return loopCharacteristics.get('isSequential') === true ? 'sequential' : 'parallel';
  }
  return 'loop';
}
