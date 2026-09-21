import { BPMN } from '@core/constants';
import type { ModdleElement } from '@core/element/moddle';
import type { Issue } from '@core/checks';
import { containers, graphOf, isA, quoted, type GraphNode } from '@core/checks/graph';

/** The nodes `from` reaches along its `side` flows, `from` included. */
function reach(nodes: Map<ModdleElement, GraphNode>, from: GraphNode[], side: 'incoming' | 'outgoing'): Set<GraphNode> {
  const end = side === 'outgoing' ? 'targetRef' : 'sourceRef';
  const seen = new Set(from);
  const queue = [...from];
  for (let current = queue.pop(); current; current = queue.pop()) {
    for (const flow of current[side]) {
      const next = nodes.get(flow[end]);
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * Well-formedness condition 3: a process or sub-process with sequence flows has a start event and an end event, and
 * each of its flow nodes lies on a path from a start event, or from a boundary event on one of its activities, to an
 * end event.
 */
export function checkSoundness(definitions: ModdleElement): Issue[] {
  const issues: Issue[] = [];
  for (const container of containers(definitions)) {
    const { flows, nodes } = graphOf(container);
    if (flows.length === 0) continue;
    const all = [...nodes.values()];
    const starts = all.filter(({ node }) => isA(node, BPMN.StartEvent));
    const ends = all.filter(({ node }) => isA(node, BPMN.EndEvent));
    for (const [kind, found] of [['start', starts], ['end', ends]] as const) {
      if (found.length > 0) continue;
      issues.push({ severity: 'error', elementId: container.id, message: `${quoted(container)} has sequence flows but no ${kind} event` });
    }
    if (starts.length === 0 || ends.length === 0) continue;

    const started = reach(nodes, [...starts, ...all.filter(({ node }) => isA(node, BPMN.BoundaryEvent))], 'outgoing');
    const ending = reach(nodes, ends, 'incoming');
    for (const graphNode of all) {
      if (started.has(graphNode) && ending.has(graphNode)) continue;
      const why = started.has(graphNode) ? 'it leads to no end event' : 'no start event leads to it';
      issues.push({
        severity: 'error',
        elementId: graphNode.node.id,
        message: `${quoted(graphNode.node)} lies on no path from a start event to an end event: ${why}`,
      });
    }
  }
  return issues;
}
