import { expect, test } from '@playwright/test';

import { CONTENT_PADDING } from '@canvas/index.ts';
import { containerOf, nextHops, startEventsIn, tokenAnchor, type Hop } from '@modeler/simulation/flowWalk';

/** The pure flow-walk decision extracted from TokenSimulator. */

// Minimal type hierarchy: each concrete type reports itself plus its supertypes, so `is()` behaves like moddle.
const SUPERTYPES: Record<string, string[]> = {
  'bpmn:StartEvent': ['bpmn:StartEvent', 'bpmn:Event', 'bpmn:FlowNode'],
  'bpmn:EndEvent': ['bpmn:EndEvent', 'bpmn:Event', 'bpmn:FlowNode'],
  'bpmn:Task': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode'],
  'bpmn:ExclusiveGateway': ['bpmn:ExclusiveGateway', 'bpmn:Gateway', 'bpmn:FlowNode'],
  'bpmn:ParallelGateway': ['bpmn:ParallelGateway', 'bpmn:Gateway', 'bpmn:FlowNode'],
  'bpmn:InclusiveGateway': ['bpmn:InclusiveGateway', 'bpmn:Gateway', 'bpmn:FlowNode'],
  'bpmn:SequenceFlow': ['bpmn:SequenceFlow', 'bpmn:FlowElement'],
};

function el(type: string, outgoing: any[] = [], id = type) {
  const types = SUPERTYPES[type] || [type];
  return {
    id,
    type,
    outgoing,
    businessObject: {
      $type: type,
      $instanceOf: (t: string) => types.includes(t),
    },
  };
}

const flow = (id = 'F') => el('bpmn:SequenceFlow', [], id);

test('nextHops: an end ends, no sequence flow is a dead end, a fork gateway takes every flow, anything else one', () => {
  const [f1, f2, f3] = [flow('F1'), flow('F2'), flow('F3')];
  const association = el('bpmn:Association');
  // [label, element, the hop's kind, the flows it may take: a fork takes all of them, an advance one]
  const CASES: Array<[string, any, Hop['kind'], any[]]> = [
    ['an end event, whatever leaves it', el('bpmn:EndEvent', [f1]), 'end', []],
    ['no outgoing flow', el('bpmn:Task'), 'deadend', []],
    ['an association is not a way on', el('bpmn:Task', [association]), 'deadend', []],
    ['one sequence flow', el('bpmn:Task', [f1]), 'advance', [f1]],
    ['an exclusive gateway picks one of its flows', el('bpmn:ExclusiveGateway', [f1, f2]), 'advance', [f1, f2]],
    ['a parallel gateway forks', el('bpmn:ParallelGateway', [f1, f2, f3]), 'fork', [f1, f2, f3]],
    ['an inclusive gateway forks', el('bpmn:InclusiveGateway', [f1, f2]), 'fork', [f1, f2]],
    ['a parallel gateway with one flow just advances', el('bpmn:ParallelGateway', [f1]), 'advance', [f1]],
    ['only sequence flows count toward a fork', el('bpmn:ParallelGateway', [f1, association]), 'advance', [f1]],
  ];
  for (const [label, element, kind, flows] of CASES) {
    const hop = nextHops(element);
    expect(hop.kind, label).toBe(kind);
    if (hop.kind === 'fork') expect(hop.flows, label).toEqual(flows);
    if (hop.kind === 'advance') {
      expect(hop.flows, label).toHaveLength(1);
      expect(flows, label).toContain(hop.flows[0]);
    }
  }
});

test.describe('containers', () => {
  const node = (type: string, parent?: any, extra: any = {}) => ({ ...el(type), kind: 'node', parent, x: 0, y: 0, width: 100, height: 80, ...extra });

  test('start events are found through pools and lanes, but not inside sub-processes', () => {
    const pool = node('bpmn:Participant');
    const lane = node('bpmn:Lane', pool);
    const sub = node('bpmn:SubProcess', lane, { id: 'sub' });
    const top = node('bpmn:StartEvent', lane, { id: 'top' });
    const inner = node('bpmn:StartEvent', sub, { id: 'inner' });
    const all = [pool, lane, sub, top, inner];
    expect(containerOf(top)).toBeUndefined();
    expect(containerOf(inner)).toBe(sub);
    expect(startEventsIn(all, undefined)).toEqual([top]);
    expect(startEventsIn(all, sub)).toEqual([inner]);
  });

  test('a token rests on the centre of a node, or in the name strip of an expanded container', () => {
    expect(tokenAnchor(node('bpmn:Task'))).toEqual({ x: 50, y: 40 });
    expect(tokenAnchor(node('bpmn:SubProcess', undefined, { isExpanded: false }))).toEqual({ x: 50, y: 40 });
    const strip = tokenAnchor(node('bpmn:SubProcess', undefined, { width: 350, height: 200 }));
    expect(strip.x).toBe(175);
    expect(strip.y).toBeGreaterThan(0);
    expect(strip.y).toBeLessThan(CONTENT_PADDING.top);
  });
});
