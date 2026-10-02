import { Graph } from '@core/engine';
import { findByFlowNode, waitsForTime } from '@runner/nodes/registry';
import { peopleOf } from '@runner/session';
import type { Studyflow } from '@runner/studyflow';
import type { ValidationIssue } from '@runner/nodes/types';

/**
 * What the notation says that a page cannot carry, refused before the first screen rather than walked as a different
 * study. The walk is the local runtime's too (packages/core/src/engine), so loops, boundary events, gateways and
 * message flows mean here what they mean there. A message flow is carried when both of its ends are in the page: a
 * step of a pool the page walks, or a pool the person at the page plays (no process, a human actor), who answers each
 * message on a screen. A pool no one in the page plays (a model, a device), and a screen that would have to exchange
 * messages itself, are refused; what a screen does not do is said as a warning: fill a data edge. A step that
 * exchanges messages has no screen, and the walk fills its data edges as it sends and receives. A timer event is never
 * handed to its screen, which only shows the walk's wait: it is the walk's, as in a local run. A step of a type no
 * screen takes is warned about too.
 */
export function validateUnwalked(studyflow: Studyflow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const locally = 'The local runtime carries it (`studyflow run --runtime local`).';
  const { elements } = studyflow.plan;
  const graph = new Graph(studyflow.plan);
  const talks = (id: string): boolean => {
    const { outgoing, incoming } = graph.exchange(elements[id]);
    return outgoing.length + incoming.length > 0;
  };
  for (const element of Object.values(elements)) {
    const label = element.name || element.id;
    const node = studyflow.flowNodes.get(element.id);
    const screen = node && findByFlowNode(node);
    const handed = screen && !waitsForTime(node) ? screen : undefined;
    if (handed && !('fallback' in handed.match && talks(element.id)) && element.inputs.length + element.outputs.length > 0) {
      issues.push({ nodeId: element.id, severity: 'warning', message: `'${label}' reads or writes data along drawn edges, which this runtime's screens do not fill. ${locally}` });
    }
    // A step of a schema's type no screen takes is passed over, but for a gateway whose schema says how it branches,
    // which the walk takes.
    if (node?.extensionType && !screen && !element.branching) {
      issues.push({ nodeId: element.id, severity: 'warning', message: `'${node.extensionType}' is not executable in this runner. This step is skipped and the run continues.` });
    }
  }
  const people = peopleOf(elements);
  for (const flow of Object.values(elements).filter((element) => element.type === 'messageFlow')) {
    for (const end of [flow.attributes.sourceRef, flow.attributes.targetRef]) {
      const element = end ? elements[end] : undefined;
      if (!element) continue;
      const label = element.name || element.id;
      if (element.type === 'participant' && !element.attributes.processRef && !people.has(element.id)) {
        issues.push({ nodeId: flow.id, message: `'${label}' is a pool no one in the page plays, so no one answers what ${flow.id} carries. ${locally}` });
      }
      const node = studyflow.flowNodes.get(element.id);
      const screen = node && findByFlowNode(node);
      if (screen && !('fallback' in screen.match) && !waitsForTime(node)) {
        issues.push({ nodeId: flow.id, message: `'${label}' is a screen, and a screen does not exchange messages along ${flow.id}. ${locally}` });
      }
    }
  }
  return issues;
}
