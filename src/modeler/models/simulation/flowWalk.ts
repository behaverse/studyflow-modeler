import { is } from 'bpmn-js/lib/util/ModelUtil';

/**
 * Pure routing decision for the token simulator: given a BPMN element, decide
 * where a token flowing through it should go next. This encodes the flow-walk
 * logic only — the animation, SVG, and canvas wiring live in TokenSimulator.
 *
 * - `end`: the element is an EndEvent; the token is consumed (popped).
 * - `deadend`: no outgoing SequenceFlows; the token bounces in place.
 * - `fork`: a Parallel/Inclusive gateway with more than one outgoing flow; the
 *   token is sent along every branch (reuse for the first, clone the rest).
 * - `advance`: a single outgoing flow is taken. When several non-fork outgoing
 *   flows exist, ONE is picked at random.
 */
export type Hop =
  | { kind: 'end' }
  | { kind: 'deadend' }
  | { kind: 'advance'; flows: any[] }
  | { kind: 'fork'; flows: any[] };

export function nextHops(element: any): Hop {
  if (is(element, 'bpmn:EndEvent')) {
    return { kind: 'end' };
  }

  const outgoing = (element.outgoing || []).filter((c: any) => is(c, 'bpmn:SequenceFlow'));

  if (outgoing.length === 0) {
    return { kind: 'deadend' };
  }

  // Parallel/Inclusive gateways fork: send the token along every branch.
  const isFork = is(element, 'bpmn:ParallelGateway') || is(element, 'bpmn:InclusiveGateway');
  if (isFork && outgoing.length > 1) {
    return { kind: 'fork', flows: outgoing };
  }

  const pick = outgoing.length > 1 ? outgoing[Math.floor(Math.random() * outgoing.length)] : outgoing[0];
  return { kind: 'advance', flows: [pick] };
}
