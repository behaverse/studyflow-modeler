import { isBpmnSubtypeOf } from '@core/notation';
import { isExpandable } from '@core/document/outline';
import { CONTENT_PADDING, type ElementRecord, type Point } from '@canvas/index.ts';

/** Reads an element by id: a study's `get`. */
export type Lookup = (id: string) => ElementRecord | undefined;

export type Hop =
  | { kind: 'end' }
  | { kind: 'deadend' }
  | { kind: 'advance'; flows: ElementRecord[] }
  | { kind: 'fork'; flows: ElementRecord[] };

export function nextHops(element: ElementRecord, get: Lookup): Hop {
  if (isBpmnSubtypeOf(element.type, 'bpmn:EndEvent')) {
    return { kind: 'end' };
  }

  const outgoing = (element.outgoing ?? []).map(get).filter((flow): flow is ElementRecord => flow?.type === 'bpmn:SequenceFlow');

  if (outgoing.length === 0) {
    return { kind: 'deadend' };
  }

  const isFork = element.type === 'bpmn:ParallelGateway' || element.type === 'bpmn:InclusiveGateway';
  if (isFork && outgoing.length > 1) {
    return { kind: 'fork', flows: outgoing };
  }

  const pick = outgoing.length > 1 ? outgoing[Math.floor(Math.random() * outgoing.length)] : outgoing[0];
  return { kind: 'advance', flows: [pick] };
}

/** The nearest sub-process (or sub-choreography) `element` lives in; pools and lanes are seen through. */
export function containerOf(element: ElementRecord, get: Lookup): ElementRecord | undefined {
  for (let p = element.parent === undefined ? undefined : get(element.parent); p; p = p.parent === undefined ? undefined : get(p.parent)) {
    if (isExpandable(p.type)) return p;
  }
  return undefined;
}

/** Start events directly under the container `within` names (the whole diagram when `undefined`), wherever their pool or lane. */
export function startEventsIn(elements: readonly ElementRecord[], within: string | undefined, get: Lookup): ElementRecord[] {
  return elements.filter((element) => element.kind === 'node' && isBpmnSubtypeOf(element.type, 'bpmn:StartEvent')
    && containerOf(element, get)?.id === within);
}

/** Where a token rests on the shape `element`: its centre, or the name strip of an expanded container, clear of its contents. */
export function tokenAnchor(element: ElementRecord): Point {
  const { x, y, width, height } = element.bounds!;
  return { x: x + width / 2, y: y + (element.expanded ? CONTENT_PADDING.top / 2 : height / 2) };
}
