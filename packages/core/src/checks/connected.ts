import { BPMN } from '@core/constants';
import type { Issue } from '@core/checks';
import { containers, graphOf, quoted, type GraphNode } from '@core/checks/graph';
import { idOf, type Element, type StudyModel } from '@core/model/index';

/** The nodes `from` reaches along its `side` flows, `from` included. Backwards, a boundary event reaches the activity
 * it sits on, which leaves through it: a loop with no flow out of it ends at the event a message ends it by. */
function reach(model: StudyModel, nodes: Map<Element, GraphNode>, from: GraphNode[], side: 'incoming' | 'outgoing'): Set<GraphNode> {
  const end = side === 'outgoing' ? 'targetRef' : 'sourceRef';
  const seen = new Set(from);
  const queue = [...from];
  for (let current = queue.pop(); current; current = queue.pop()) {
    const host = side === 'incoming' ? [current.node.attachedToRef] : [];
    for (const next of [...current[side].map((flow) => flow[end]), ...host].map((ref) => nodes.get(model.get(idOf(ref) ?? undefined)!))) {
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
export function checkConnected(model: StudyModel): Issue[] {
  const issues: Issue[] = [];
  for (const container of containers(model)) {
    const { flows, nodes } = graphOf(model, container);
    if (flows.length === 0) continue;
    const all = [...nodes.values()];
    const starts = all.filter(({ node }) => model.isA(node, BPMN.StartEvent));
    const ends = all.filter(({ node }) => model.isA(node, BPMN.EndEvent));
    for (const [kind, found] of [['start', starts], ['end', ends]] as const) {
      if (found.length > 0) continue;
      issues.push({ severity: 'error', elementId: container.id, message: `${quoted(container)} has sequence flows but no ${kind} event` });
    }
    if (starts.length === 0 || ends.length === 0) continue;

    const started = reach(model, nodes, [...starts, ...all.filter(({ node }) => model.isA(node, BPMN.BoundaryEvent))], 'outgoing');
    const ending = reach(model, nodes, ends, 'incoming');
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
