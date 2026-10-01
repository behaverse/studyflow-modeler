import { BPMN } from '@core/constants';
import { META_KEY } from '@core/model/state';
import type { Element, StudyModel } from '@core/model/index';
import type { Issue } from '@core/checks';
import { containers, graphOf, quoted } from '@core/checks/graph';

/**
 * Flow consistency of a run's counts, `state._meta.reached`: the tokens that reached a flow node are the tokens its
 * incoming sequence flows brought (a start or boundary event starts its own), and they leave by its outgoing flows or
 * its boundary events (an end event keeps them); a parallel split sends each along every flow, and an inclusive split,
 * an activity with several flows out and a join are not counted exactly. A file whose runs counted no sequence flow is not checked.
 */
export function checkFlowConsistency(model: StudyModel): Issue[] {
  const reached = (model.study.state?.[META_KEY] as { reached?: Record<string, number> } | undefined)?.reached;
  if (!reached || typeof reached !== 'object') return [];
  const count = (element: Element): number => Number(reached[element.id ?? ''] ?? 0);
  const sum = (elements: Element[]): number => elements.reduce((total, element) => total + count(element), 0);

  const graphs = containers(model).map((container) => graphOf(model, container)).filter(({ flows }) => flows.length > 0);
  if (!graphs.some(({ flows }) => flows.some((flow) => (flow.id ?? '') in reached))) return [];

  const issues: Issue[] = [];
  for (const { nodes } of graphs) {
    for (const { node, incoming, outgoing, boundaries } of nodes.values()) {
      const n = count(node);
      const error = (message: string) => issues.push({ severity: 'error', elementId: node.id, message: `flow consistency at ${quoted(node)}: ${message}` });
      const inflow = sum(incoming);
      if (!model.isA(node, BPMN.StartEvent) && !model.isA(node, BPMN.BoundaryEvent) && n !== inflow) {
        error(`reached ${n} != inflow ${inflow} (${Math.abs(n - inflow)} unaccounted)`);
      }
      const [outflow, attrition] = [sum(outgoing), sum(boundaries)];
      // A parallel split sends a token along each of its flows; an inclusive split, or an activity with several flows
      // out, along the ones it takes; a join sends one on for the tokens it gathered.
      const parallel = model.isA(node, BPMN.ParallelGateway);
      const joins = incoming.length > 1 && (parallel || model.isA(node, BPMN.InclusiveGateway));
      const splits = outgoing.length > 1 && (parallel || model.isA(node, BPMN.InclusiveGateway) || !model.isA(node, BPMN.Gateway));
      if (joins || (splits && !parallel)) continue;
      const leaving = splits ? n * outgoing.length : n;
      if (!model.isA(node, BPMN.EndEvent) && leaving !== outflow + attrition) {
        error(`${splits ? `${n} tokens split ${outgoing.length} ways` : `inflow ${n}`} != outflow ${outflow} + attrition ${attrition} (${Math.abs(leaving - outflow - attrition)} unaccounted)`);
      }
    }
  }
  return issues;
}
