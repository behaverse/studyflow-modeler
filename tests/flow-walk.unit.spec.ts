import { expect, test } from '@playwright/test';

import { nextHops } from '@modeler/simulation/flowWalk';

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

test.describe('nextHops', () => {
  test('EndEvent -> end', () => {
    expect(nextHops(el('bpmn:EndEvent', [flow('F1')]))).toEqual({ kind: 'end' });
  });

  test('no outgoing sequence flows -> deadend', () => {
    expect(nextHops(el('bpmn:Task', []))).toEqual({ kind: 'deadend' });
  });

  test('outgoing present but none are sequence flows -> deadend', () => {
    const assoc = el('bpmn:Association', []);
    expect(nextHops(el('bpmn:Task', [assoc]))).toEqual({ kind: 'deadend' });
  });

  test('single outgoing sequence flow -> advance with that flow', () => {
    const f = flow('F1');
    const hop = nextHops(el('bpmn:Task', [f]));
    expect(hop.kind).toBe('advance');
    expect((hop as any).flows).toEqual([f]);
  });

  test('non-fork element with multiple outgoing -> advance with exactly one flow', () => {
    const f1 = flow('F1');
    const f2 = flow('F2');
    const hop = nextHops(el('bpmn:ExclusiveGateway', [f1, f2]));
    expect(hop.kind).toBe('advance');
    expect((hop as any).flows).toHaveLength(1);
    expect([f1, f2]).toContain((hop as any).flows[0]);
  });

  test('ParallelGateway with >1 outgoing -> fork with all flows', () => {
    const f1 = flow('F1');
    const f2 = flow('F2');
    const f3 = flow('F3');
    const hop = nextHops(el('bpmn:ParallelGateway', [f1, f2, f3]));
    expect(hop.kind).toBe('fork');
    expect((hop as any).flows).toEqual([f1, f2, f3]);
  });

  test('InclusiveGateway with >1 outgoing -> fork with all flows', () => {
    const f1 = flow('F1');
    const f2 = flow('F2');
    const hop = nextHops(el('bpmn:InclusiveGateway', [f1, f2]));
    expect(hop.kind).toBe('fork');
    expect((hop as any).flows).toEqual([f1, f2]);
  });

  test('ParallelGateway with a single outgoing -> advance (not fork)', () => {
    const f1 = flow('F1');
    const hop = nextHops(el('bpmn:ParallelGateway', [f1]));
    expect(hop.kind).toBe('advance');
    expect((hop as any).flows).toEqual([f1]);
  });

  test('fork only counts sequence flows toward the >1 threshold', () => {
    const f1 = flow('F1');
    const assoc = el('bpmn:Association', []);
    const hop = nextHops(el('bpmn:ParallelGateway', [f1, assoc]));
    expect(hop.kind).toBe('advance');
    expect((hop as any).flows).toEqual([f1]);
  });
});

import { containerOf, startEventsIn, tokenAnchor } from '@modeler/simulation/flowWalk';

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
    expect(tokenAnchor(node('bpmn:SubProcess', undefined, { width: 350, height: 200 }))).toEqual({ x: 175, y: 20 });
  });
});
