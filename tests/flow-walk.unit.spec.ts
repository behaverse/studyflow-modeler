import { expect, test } from '@playwright/test';

import type { ElementRecord } from '@canvas/index.ts';
import { containerOf, nextHops, startEventsIn, tokenAnchor, type Hop, type Lookup } from '@modeler/simulation/flowWalk';

/** The pure flow-walk decisions the token simulation takes, over records and a lookup by id. */

const BOX = { x: 0, y: 0, width: 100, height: 80 };

const shape = (id: string, type: string, extra: Partial<ElementRecord> = {}): ElementRecord => ({ id, kind: 'node', type, bounds: BOX, ...extra });
const flow = (id: string, type = 'bpmn:SequenceFlow'): ElementRecord => ({ id, kind: 'edge', type, waypoints: [] });

function lookup(...records: ElementRecord[]): Lookup {
  const byId = new Map(records.map((record) => [record.id, record]));
  return (id) => byId.get(id);
}

test('nextHops: an end ends, no sequence flow is a dead end, a fork gateway takes every flow, anything else one', () => {
  const [f1, f2, f3] = [flow('F1'), flow('F2'), flow('F3')];
  const association = flow('A', 'bpmn:Association');
  const get = lookup(f1, f2, f3, association);
  const node = (type: string, outgoing: ElementRecord[] = []): ElementRecord => shape(type, type, { outgoing: outgoing.map((out) => out.id) });
  // [label, element, the hop's kind, the flows it may take: a fork takes all of them, an advance one]
  const CASES: Array<[string, ElementRecord, Hop['kind'], ElementRecord[]]> = [
    ['an end event, whatever leaves it', node('bpmn:EndEvent', [f1]), 'end', []],
    ['no outgoing flow', node('bpmn:Task'), 'deadend', []],
    ['an association is not a way on', node('bpmn:Task', [association]), 'deadend', []],
    ['one sequence flow', node('bpmn:Task', [f1]), 'advance', [f1]],
    ['an exclusive gateway picks one of its flows', node('bpmn:ExclusiveGateway', [f1, f2]), 'advance', [f1, f2]],
    ['a parallel gateway forks', node('bpmn:ParallelGateway', [f1, f2, f3]), 'fork', [f1, f2, f3]],
    ['an inclusive gateway forks', node('bpmn:InclusiveGateway', [f1, f2]), 'fork', [f1, f2]],
    ['a parallel gateway with one flow just advances', node('bpmn:ParallelGateway', [f1]), 'advance', [f1]],
    ['only sequence flows count toward a fork', node('bpmn:ParallelGateway', [f1, association]), 'advance', [f1]],
  ];
  for (const [label, element, kind, flows] of CASES) {
    const hop = nextHops(element, get);
    expect(hop.kind, label).toBe(kind);
    if (hop.kind === 'fork') expect(hop.flows, label).toEqual(flows);
    if (hop.kind === 'advance') {
      expect(hop.flows, label).toHaveLength(1);
      expect(flows, label).toContain(hop.flows[0]);
    }
  }
});

test.describe('containers', () => {
  test('start events are found through pools and lanes, but not inside sub-processes', () => {
    const pool = shape('pool', 'bpmn:Participant');
    const lane = shape('lane', 'bpmn:Lane', { parent: 'pool' });
    const sub = shape('sub', 'bpmn:SubProcess', { parent: 'lane', expanded: true });
    const top = shape('top', 'bpmn:StartEvent', { parent: 'lane' });
    const inner = shape('inner', 'bpmn:StartEvent', { parent: 'sub' });
    const all = [pool, lane, sub, top, inner];
    const get = lookup(...all);
    expect(containerOf(top, get)).toBeUndefined();
    expect(containerOf(inner, get)).toBe(sub);
    expect(startEventsIn(all, undefined, get)).toEqual([top]);
    expect(startEventsIn(all, 'sub', get)).toEqual([inner]);
  });

  test('a token rests on the centre of a node, or on the top edge of an expanded container', () => {
    expect(tokenAnchor(shape('task', 'bpmn:Task'))).toEqual({ x: 50, y: 40 });
    expect(tokenAnchor(shape('sub', 'bpmn:SubProcess', { expanded: false }))).toEqual({ x: 50, y: 40 });
    expect(tokenAnchor(shape('sub', 'bpmn:SubProcess', { expanded: true, bounds: { x: 0, y: 0, width: 350, height: 200 } })))
      .toEqual({ x: 175, y: 0 });
  });
});
