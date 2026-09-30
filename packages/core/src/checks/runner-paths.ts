import { BPMN } from '@core/constants';
import type { ModdleElement } from '@core/element/moddle';
import type { Issue } from '@core/checks';
import { containers, graphOf, isA, quoted } from '@core/checks/graph';

/**
 * Splits the walk does not take: it walks one path per pool (packages/core/src/engine/walk.ts). A parallel split stops a run; an activity or event goes on along its first
 * outgoing flow only. An inclusive gateway would take every flow whose condition holds, which no pool's one path can,
 * and a complex gateway goes by an activation rule the walk does not read: each stops a run too, rather than being
 * walked as an exclusive one.
 */
export function checkRunnerPaths(definitions: ModdleElement): Issue[] {
  const issues: Issue[] = [];
  for (const container of containers(definitions)) {
    for (const { node, outgoing } of graphOf(container).nodes.values()) {
      if (outgoing.length < 2) continue;
      const n = outgoing.length;
      if (isA(node, BPMN.ParallelGateway)) {
        issues.push({
          severity: 'error',
          elementId: node.id,
          message: `${quoted(node)} splits into ${n} parallel paths; a pool walks one path, so the walk stops here`,
        });
      } else if (isA(node, BPMN.InclusiveGateway)) {
        issues.push({
          severity: 'error',
          elementId: node.id,
          message: `${quoted(node)} is an inclusive gateway with ${n} outgoing flows; a pool walks one path, so the walk stops here rather than take only the first whose condition holds`,
        });
      } else if (isA(node, BPMN.ComplexGateway)) {
        issues.push({
          severity: 'error',
          elementId: node.id,
          message: `${quoted(node)} is a complex gateway with ${n} outgoing flows; the walk reads no activation rule, so it stops here rather than take it as an exclusive gateway`,
        });
      } else if (!isA(node, BPMN.Gateway)) {
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
