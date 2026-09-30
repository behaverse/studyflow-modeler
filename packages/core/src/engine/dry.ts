import { CONTAINER_TYPES, GATEWAY_TYPES, Graph, NOT_FLOW_NODES } from '@core/engine/graph';
import type { Plan } from '@core/engine/plan';
import type { Host } from '@core/engine/host';

/**
 * The host of a dry run: the study is walked and nothing is executed. Every step a runner would take is done at once,
 * a pool no process depicts answers null, and a gateway whose condition reads what a step would have bound takes one
 * of its flows at random, so a dry run shows where a run may go rather than what one run found. A step that
 * exchanges messages does its own, as the walk has an unclaimed one do. `shown` hears the token move.
 */
export function dryHost(plan: Plan, shown: Pick<Host, 'moved' | 'passed'> = {}): Host {
  const graph = new Graph(plan);
  const performed = new Set<string>();
  for (const id of graph.walked) {
    const element = graph.elements[id];
    const routes = NOT_FLOW_NODES.has(element.type) || GATEWAY_TYPES.has(element.type) || CONTAINER_TYPES.has(element.type)
      || element.type === 'parallelGateway' || element.type.endsWith('Event');
    const { outgoing, incoming } = graph.exchange(element);
    if (!routes && outgoing.length + incoming.length === 0) performed.add(id);
  }
  for (const [id, participant] of graph.participants) if (!participant.attributes.processRef) performed.add(id);
  return {
    claim: (id) => (performed.has(id) ? { name: 'dry run', live: true } : undefined),
    perform: async () => ({}),
    log: () => undefined,
    now: () => new Date().toISOString(),
    decide: (_gateway, flows) => flows[Math.floor(Math.random() * flows.length)],
    // No time passes in a dry run: a timer event passes at once, and a timer at a boundary event runs out or not,
    // at random, so both ways off its activity are shown.
    wait: (_ms, _signal, at) => (graph.elements[at]?.type === 'boundaryEvent' && Math.random() < 0.5 ? new Promise(() => undefined) : Promise.resolve()),
    ...shown,
  };
}
