import { is } from '@modeler/editor/port';
import { CONTENT_PADDING, isExpandable, isExpanded } from '@canvas/model/tree.ts';
import type { Point } from '@canvas/model/scene.ts';

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

/** The nearest sub-process (or sub-choreography) `element` lives in; pools and lanes are seen through. */
export function containerOf(element: any): any | undefined {
  for (let p = element?.parent; p; p = p.parent) if (isExpandable(p.type)) return p;
  return undefined;
}

/** Start events directly under `container` (the whole diagram when `undefined`), wherever their pool or lane. */
export function startEventsIn(elements: any[], container: any | undefined): any[] {
  return elements.filter((el) => el.kind === 'node' && is(el, 'bpmn:StartEvent') && containerOf(el) === container);
}

/** Where a token rests on `element`: its centre, or the name strip of an expanded container, clear of its contents. */
export function tokenAnchor(element: any): Point {
  const expanded = element.kind === 'node' && isExpanded(element);
  return {
    x: element.x + element.width / 2,
    y: element.y + (expanded ? CONTENT_PADDING.top / 2 : element.height / 2),
  };
}
