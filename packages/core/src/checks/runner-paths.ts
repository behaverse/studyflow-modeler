import { BPMN } from '@core/constants';
import type { ModdleElement } from '@core/element/moddle';
import type { Issue } from '@core/checks';
import { containers, graphOf, isA, quoted } from '@core/checks/graph';

/**
 * Splits the reference runners do not take: each walks one path per pool (skills/local/run.py and
 * skills/browser/src/session.ts). A parallel split stops a run; an activity or event goes on along its first
 * outgoing flow only; an inclusive gateway, like an exclusive one, takes the first flow whose condition holds.
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
          message: `${quoted(node)} splits into ${n} parallel paths; a pool walks one path, so the reference runners stop here`,
        });
      } else if (isA(node, BPMN.InclusiveGateway)) {
        issues.push({
          severity: 'warning',
          elementId: node.id,
          message: `${quoted(node)} is an inclusive gateway with ${n} outgoing flows; the reference runners take the first whose condition holds, not every one`,
        });
      } else if (!isA(node, BPMN.Gateway)) {
        issues.push({
          severity: 'error',
          elementId: node.id,
          message: `${quoted(node)} has ${n} outgoing sequence flows; a pool walks one path, so the reference runners follow only the first, ${quoted(outgoing[0])}`,
        });
      }
    }
  }
  return issues;
}
