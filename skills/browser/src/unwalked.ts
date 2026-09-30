import type { Studyflow } from '@runner/studyflow';
import type { ValidationIssue } from '@runner/nodes/types';

/**
 * What the notation says that a page cannot carry, refused before the first screen rather than walked as a different
 * study: a message flow between pools, which needs the other pool's runner on this machine. The walk is the local
 * runtime's too (packages/core/src/engine), so loops, boundary events and gateways mean here what they mean there;
 * what a screen does not do is said as a warning: fill a data edge.
 */
export function validateUnwalked(studyflow: Studyflow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const locally = 'The local runtime carries it (`studyflow run --runtime local`).';
  for (const element of Object.values(studyflow.plan.elements)) {
    const label = element.name || element.id;
    if (element.inputs.length + element.outputs.length > 0) {
      issues.push({ nodeId: element.id, severity: 'warning', message: `'${label}' reads or writes data along drawn edges, which this runtime's screens do not fill. ${locally}` });
    }
  }
  const flows = Object.values(studyflow.plan.elements).filter((element) => element.type === 'messageFlow');
  if (flows.length > 0) {
    issues.push({ nodeId: flows[0].id, message: `This study exchanges messages between pools (${flows.length} message flow${flows.length === 1 ? '' : 's'}), which a page cannot carry: no runner plays the other pool here. ${locally}` });
  }
  return issues;
}
