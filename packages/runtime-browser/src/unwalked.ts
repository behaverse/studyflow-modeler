import { GATEWAY_TYPES, Graph } from '@core/engine';
import { PARAMETERS } from '@core/model/parameters';
import { findByFlowNode, waitsForTime } from '@runner/nodes/registry';
import { peopleOf } from '@runner/session';
import type { Studyflow } from '@runner/studyflow';
import type { ValidationIssue } from '@runner/nodes/types';

/**
 * The parts of the notation a page cannot carry. They are refused before the first screen, so the study is never
 * walked as a different one. The walk is the local runtime's too (packages/core/src/engine), so loops, boundary
 * events, gateways and message flows mean here what they mean there. A message flow is carried when both of its ends
 * are in the page: a step of a pool the page walks, or a pool the person at the page plays (no process, a human
 * actor), who answers each message on a screen. A pool no one in the page plays (a model, a device), and a screen
 * that would have to exchange messages itself, are refused. The exchange a task's band stands for (the plan's
 * `bandExchanges`) is carried when the task's screen plays the pool on the band itself (`playsBand`).
 *
 * What a screen does not do is said as a warning: fill a data edge. Three kinds of edge are filled, and not warned
 * of: the Parameters wired into a step, which are bound before the walk; a data object the screen reads itself
 * (`reads`); and the data outputs of a screen that gives a result (`answers`), which is written along them. A page
 * holds such a value for the run and saves nothing, so a data output kept at a `uri` is warned of in its own right. A
 * step that exchanges messages has no screen, and the walk fills its data edges as it sends and receives.
 *
 * A timer event is never handed to its screen, which only shows the walk's wait: it is the walk's, as in a local
 * run. So is every gateway. A step of a schema's type that no screen takes is warned about too: the run passes over
 * it without a screen.
 */
export function validateUnwalked(studyflow: Studyflow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const locally = 'The local runtime carries it (`studyflow run --runtime local`).';
  const { model } = studyflow;
  const { elements } = studyflow.plan;
  const graph = new Graph(studyflow.plan);
  const talks = (id: string): boolean => {
    const { outgoing, incoming } = graph.exchange(elements[id]);
    return outgoing.length + incoming.length > 0;
  };
  /** The data elements kept at a `uri` that a screen's result is written to. */
  const held = new Set<string>();
  for (const element of Object.values(elements)) {
    const label = element.name || element.id;
    const node = studyflow.flowNodes.get(element.id);
    const screen = node && findByFlowNode(node);
    const handed = screen && !waitsForTime(node) ? screen : undefined;
    if (node && handed && !('fallback' in handed.match && talks(element.id))) {
      // The Parameters wired into a step are bound before the walk, and a screen may read other wired data itself.
      const read = new Set(handed.reads?.(node));
      const unread = element.inputs.filter(({ source }) => {
        const wired = model.get(source);
        return !read.has(source) && !(wired && model.extensionType(wired) === PARAMETERS);
      });
      // The result a screen gives is written along its step's data outputs, and held there for the run.
      const unwritten = handed.answers ? [] : element.outputs;
      if (handed.answers) for (const { target } of element.outputs) if (target && graph.uriOf(target)) held.add(target);
      if (unread.length + unwritten.length > 0) {
        issues.push({ nodeId: element.id, severity: 'warning', message: `'${label}' reads or writes data along drawn edges, which this runtime's screens do not fill. ${locally}` });
      }
    }
    // A step of a schema's type no screen takes is passed over, but for a gateway, which the walk decides whatever its
    // type: by its flows' conditions, or by a draw.
    if (node?.extensionType && !screen && !GATEWAY_TYPES.has(element.type) && element.type !== 'parallelGateway') {
      issues.push({ nodeId: element.id, severity: 'warning', message: `This runtime has no screen for a ${node.extensionType}: the run passes over this step without one.` });
    }
  }
  for (const id of held) {
    issues.push({ nodeId: id, severity: 'warning', message: `'${elements[id].name || id}' is kept at ${graph.uriOf(id)}, which this runtime neither loads nor saves. ${locally}` });
  }
  const people = peopleOf(elements);
  for (const flow of Object.values(elements).filter((element) => element.type === 'messageFlow')) {
    // A screen that plays the pool on its step's band holds the whole exchange the band stands for.
    const banded = studyflow.flowNodes.get(flow.attributes.band ?? '');
    if (banded && findByFlowNode(banded)?.playsBand?.(banded)) continue;
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
