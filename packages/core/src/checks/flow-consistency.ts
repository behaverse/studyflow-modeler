import { BPMN } from '@core/constants';
import type { ModdleElement } from '@core/element/moddle';
import { META_KEY, readState } from '@core/document/state';
import type { Issue } from '@core/checks';
import { containers, graphOf, isA, quoted } from '@core/checks/graph';

/**
 * Flow consistency of a run's counts, `state._meta.reached`: the tokens that reached a flow node are the tokens its
 * incoming sequence flows brought (a start or boundary event starts its own), and they leave by its outgoing flows or
 * its boundary events (an end event keeps them). A file whose runs counted no sequence flow is not checked.
 */
export function checkFlowConsistency(definitions: ModdleElement): Issue[] {
  const reached = readState(definitions)[META_KEY]?.reached;
  if (!reached || typeof reached !== 'object') return [];
  const count = (element: ModdleElement): number => Number(reached[element.id] ?? 0);
  const sum = (elements: ModdleElement[]): number => elements.reduce((total, element) => total + count(element), 0);

  const graphs = containers(definitions).map(graphOf).filter(({ flows }) => flows.length > 0);
  if (!graphs.some(({ flows }) => flows.some((flow) => flow.id in reached))) return [];

  const issues: Issue[] = [];
  for (const { nodes } of graphs) {
    for (const { node, incoming, outgoing, boundaries } of nodes.values()) {
      const n = count(node);
      const error = (message: string) => issues.push({ severity: 'error', elementId: node.id, message: `flow consistency at ${quoted(node)}: ${message}` });
      const inflow = sum(incoming);
      if (!isA(node, BPMN.StartEvent) && !isA(node, BPMN.BoundaryEvent) && n !== inflow) {
        error(`reached ${n} != inflow ${inflow} (${Math.abs(n - inflow)} unaccounted)`);
      }
      const [outflow, attrition] = [sum(outgoing), sum(boundaries)];
      if (!isA(node, BPMN.EndEvent) && n !== outflow + attrition) {
        error(`inflow ${n} != outflow ${outflow} + attrition ${attrition} (${Math.abs(n - outflow - attrition)} unaccounted)`);
      }
    }
  }
  return issues;
}
