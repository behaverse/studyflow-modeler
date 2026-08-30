import { is } from '@modeler/editor/port';

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

  const isFork = is(element, 'bpmn:ParallelGateway') || is(element, 'bpmn:InclusiveGateway');
  if (isFork && outgoing.length > 1) {
    return { kind: 'fork', flows: outgoing };
  }

  const pick = outgoing.length > 1 ? outgoing[Math.floor(Math.random() * outgoing.length)] : outgoing[0];
  return { kind: 'advance', flows: [pick] };
}
