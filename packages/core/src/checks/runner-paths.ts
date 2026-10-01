import { BPMN } from '@core/constants';
import type { Issue } from '@core/checks';
import { containers, graphOf, quoted } from '@core/checks/graph';
import type { StudyModel } from '@core/model/index';

/**
 * What the walk reads otherwise than BPMN (packages/core/src/engine/walk.ts, skills/local/WALK.md): a complex
 * gateway, whose activation rule it does not read, stops a run where it splits and passes each token where it joins;
 * a scope's second start event never starts it. Parallel and inclusive splits and joins are walked as BPMN says, and
 * a join one of whose tokens can never come is the soundness check's to find.
 */
export function checkRunnerPaths(model: StudyModel): Issue[] {
  const issues: Issue[] = [];
  for (const container of containers(model)) {
    const { nodes } = graphOf(model, container);
    // BPMN starts a scope at each of its start events; the walk, at the first.
    const starts = [...nodes.keys()].filter((node) => model.isA(node, BPMN.StartEvent));
    if (starts.length > 1) {
      issues.push({
        severity: 'warning',
        elementId: starts[1].id,
        message: `${quoted(container)} has ${starts.length} start events; the walk starts it at the first, ${quoted(starts[0])}, so a path from ${starts.slice(1).map(quoted).join(', ')} never runs`,
      });
    }
    for (const { node, incoming, outgoing } of nodes.values()) {
      if (!model.isA(node, BPMN.ComplexGateway)) continue;
      if (incoming.length > 1) {
        issues.push({
          severity: 'warning',
          elementId: node.id,
          message: `${quoted(node)} joins ${incoming.length} paths by an activation rule the walk does not read, so it passes each as it arrives`,
        });
      }
      if (outgoing.length > 1) {
        issues.push({
          severity: 'error',
          elementId: node.id,
          message: `${quoted(node)} is a complex gateway with ${outgoing.length} outgoing flows; the walk reads no activation rule, so it stops here rather than take it as another kind of gateway`,
        });
      }
    }
  }
  return issues;
}
