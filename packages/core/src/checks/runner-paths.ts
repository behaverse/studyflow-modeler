import { BPMN } from '@core/constants';
import type { Issue } from '@core/checks';
import { containers, graphOf, quoted } from '@core/checks/graph';
import type { StudyModel } from '@core/model/index';

/**
 * Splits the walk does not take: it walks one path per pool (packages/core/src/engine/walk.ts). A parallel split stops a run; an activity or event goes on along its first
 * outgoing flow only. An inclusive gateway would take every flow whose condition holds, which no pool's one path can,
 * and a complex gateway goes by an activation rule the walk does not read: each stops a run too, rather than being
 * walked as an exclusive one. A join that waits in BPMN, and a scope's second start event, are warned about: the walk
 * passes the one and never starts at the other.
 */
export function checkRunnerPaths(model: StudyModel): Issue[] {
  const issues: Issue[] = [];
  for (const container of containers(model)) {
    const { nodes } = graphOf(model, container);
    // BPMN starts a scope at each of its start events; the walk, one path, at the first.
    const starts = [...nodes.keys()].filter((node) => model.isA(node, BPMN.StartEvent));
    if (starts.length > 1) {
      issues.push({
        severity: 'warning',
        elementId: starts[1].id,
        message: `${quoted(container)} has ${starts.length} start events; a pool walks one path, from the first, ${quoted(starts[0])}, so a path from ${starts.slice(1).map(quoted).join(', ')} never runs`,
      });
    }
    for (const { node, incoming, outgoing } of nodes.values()) {
      // A parallel, inclusive or complex join waits in BPMN for the paths it joins; the walk has one token, which
      // passes it at once.
      if (incoming.length > 1 && [BPMN.ParallelGateway, BPMN.InclusiveGateway, BPMN.ComplexGateway].some((type) => model.isA(node, type))) {
        issues.push({
          severity: 'warning',
          elementId: node.id,
          message: `${quoted(node)} joins ${incoming.length} paths, which BPMN waits for; a pool walks one path, so the walk passes it as it arrives (an exclusive gateway merges without waiting)`,
        });
      }
      if (outgoing.length < 2) continue;
      const n = outgoing.length;
      if (model.isA(node, BPMN.ParallelGateway)) {
        issues.push({
          severity: 'error',
          elementId: node.id,
          message: `${quoted(node)} splits into ${n} parallel paths; a pool walks one path, so the walk stops here`,
        });
      } else if (model.isA(node, BPMN.InclusiveGateway)) {
        issues.push({
          severity: 'error',
          elementId: node.id,
          message: `${quoted(node)} is an inclusive gateway with ${n} outgoing flows; a pool walks one path, so the walk stops here rather than take only the first whose condition holds`,
        });
      } else if (model.isA(node, BPMN.ComplexGateway)) {
        issues.push({
          severity: 'error',
          elementId: node.id,
          message: `${quoted(node)} is a complex gateway with ${n} outgoing flows; the walk reads no activation rule, so it stops here rather than take it as an exclusive gateway`,
        });
      } else if (!model.isA(node, BPMN.Gateway)) {
        issues.push({
          severity: 'error',
          elementId: node.id,
          message: `${quoted(node)} has ${n} outgoing sequence flows; a pool walks one path, so the walk follows only the first, ${quoted(outgoing[0])}`,
        });
      }
    }
  }
  return issues;
}
