import { BPMN } from '@core/constants';
import type { Issue } from '@core/checks';
import { containers, graphOf, quoted } from '@core/checks/graph';
import { Graph } from '@core/engine/graph';
import { planOf } from '@core/engine/plan';
import { expressionOf, idOf, isElement, type Element, type StudyModel } from '@core/model/index';

/** The event definitions the walk reads: a message (along the message flows), a timer, an error, a condition, a terminate. */
const READ_EVENTS = ['bpmn:MessageEventDefinition', 'bpmn:TimerEventDefinition', 'bpmn:ErrorEventDefinition', 'bpmn:ConditionalEventDefinition', 'bpmn:TerminateEventDefinition'];

/** An event definition's kind as a sentence names it, where `a` and its local name do not. */
const KINDS: Record<string, string> = { Escalation: 'an escalation', Compensate: 'a compensation' };

/**
 * Where the walk departs from BPMN (packages/core/src/engine/walk.ts, packages/runtime-local/WALK.md): a complex
 * gateway, whose activation rule it does not read, stops a run where it splits and passes each token where it joins;
 * a scope's second start event never starts it; and an event of a kind it does not read (a signal, an escalation, a
 * compensation, a link, a cancel), each reaching beyond where it is drawn, would pass as a plain event, so it is
 * refused. Parallel and inclusive splits and joins are walked as BPMN says, and a join one of whose tokens can never
 * come is the soundness check's to find. A standard loop with neither a condition nor a maximum, and no boundary event
 * to end it, repeats until the walk gives up on it, so it is refused too. So is an event-based gateway branch with no
 * event to wait for, where the run would stop, and a call activity that calls a process it is inside, which would call
 * itself without end; one naming no process of the study passes as a task, and an error boundary event marked as not
 * interrupting interrupts all the same, as BPMN has it (warnings).
 */
export function checkRunnerPaths(model: StudyModel): Issue[] {
  const issues: Issue[] = [];
  const processes = new Map(model.study.roots.filter((root) => model.isA(root, 'bpmn:Process')).map((root) => [root.id, root]));
  const calledBy = (node: Element): Element | undefined => {
    const ref = node.calledElement;
    const id = typeof ref === 'string' ? ref : idOf(ref);
    return id ? processes.get(id) : undefined;
  };
  const processOf = (element: Element): Element => {
    let at = element;
    for (let up = model.parentOf(at); up; up = model.parentOf(up)) at = up;
    return at;
  };
  // The processes each process calls, through the call activities anywhere inside it.
  const calls = new Map<Element, Set<Element>>();
  for (const container of containers(model)) {
    for (const node of graphOf(model, container).nodes.keys()) {
      const called = model.isA(node, BPMN.CallActivity) ? calledBy(node) : undefined;
      if (called) calls.set(processOf(container), new Set([...(calls.get(processOf(container)) ?? []), called]));
    }
  }
  const reaches = (from: Element, to: Element): boolean => {
    const seen = new Set<Element>();
    const queue = [from];
    for (let at = queue.pop(); at; at = queue.pop()) {
      if (at === to) return true;
      if (seen.has(at)) continue;
      seen.add(at);
      queue.push(...(calls.get(at) ?? []));
    }
    return false;
  };
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
    for (const { node, incoming, outgoing, boundaries } of nodes.values()) {
      if (repeatsForever(model, node, boundaries)) {
        issues.push({
          severity: 'error',
          elementId: node.id,
          message: `${quoted(node)} repeats with neither a loopCondition nor a loopMaximum, and no boundary event to end it, so it never ends; give it a loopCondition or a loopMaximum`,
        });
      }
      const definitions = Array.isArray(node.eventDefinitions) ? node.eventDefinitions.filter(isElement) : [];
      if (model.isA(node, BPMN.BoundaryEvent) && (node.cancelActivity === false || node.cancelActivity === 'false')
        && definitions.some((definition) => model.isA(definition, 'bpmn:ErrorEventDefinition'))) {
        issues.push({
          severity: 'warning',
          elementId: node.id,
          message: `${quoted(node)} is an error boundary event marked as not interrupting, which BPMN does not allow: an error always ends its activity, so the walk leaves the activity at it all the same`,
        });
      }
      if (model.isA(node, BPMN.CallActivity)) {
        const called = calledBy(node);
        const ref = typeof node.calledElement === 'string' ? node.calledElement : idOf(node.calledElement);
        if (!called) {
          issues.push({
            severity: 'warning',
            elementId: node.id,
            message: `${quoted(node)} calls ${ref ? `"${ref}"` : 'nothing'}, which is no process of this study, so it passes as a task a runner may claim; name a process the study holds in calledElement`,
          });
        } else if (reaches(called, processOf(container))) {
          issues.push({
            severity: 'error',
            elementId: node.id,
            message: `${quoted(node)} calls ${quoted(called)}, which ${called === processOf(container) ? 'it is inside' : `calls back into ${quoted(processOf(container))}`}, so the process would call itself without end; draw the repeat as a loop marker instead`,
          });
        }
      }
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
  for (const definition of model.all()) {
    if (!model.isA(definition, 'bpmn:EventDefinition') || READ_EVENTS.some((type) => model.isA(definition, type))) continue;
    const event = model.parentOf(definition) ?? definition;
    const kind = definition.type.replace(/^.*:/, '').replace(/EventDefinition$/, '');
    const named = KINDS[kind] ?? `a ${kind.toLowerCase()}`;
    issues.push({
      severity: 'error',
      elementId: model.ownerOf(event),
      message: `${quoted(event)} is ${named} event, which the walk does not read, so it would pass as a plain event; draw what it does with sequence and message flows`,
    });
  }
  return [...issues, ...checkEventGateways(model)];
}

/** An event-based gateway takes the branch whose event happens first: a message along a flow into it, its timer
 * running out, or its condition holding. A branch with none of them stops the run. Read off the plan, whose message
 * flows include the ones a task's band stands for. */
function checkEventGateways(model: StudyModel): Issue[] {
  let graph: Graph;
  try {
    graph = new Graph(planOf(model));
  } catch {
    return []; // a study the walk cannot plan is reported by the other checks
  }
  const named = (id: string): string => `"${graph.elements[id]?.name || id}"`;
  const issues: Issue[] = [];
  for (const id of graph.walked) {
    if (graph.elements[id].type !== 'eventBasedGateway') continue;
    for (const flow of graph.outgoing.get(id) ?? []) {
      const target = graph.get(flow.attributes.targetRef);
      const conditional = (target?.events ?? []).includes('conditionalEventDefinition') && target?.condition;
      if (!target || graph.flowsIn.has(target.id) || target.timer || conditional) continue;
      issues.push({
        severity: 'error',
        elementId: id,
        message: `${named(id)} is an event-based gateway, which waits for the first event of its branches, and ${named(target.id)} has none to wait for, so the run stops here; start each branch with a catch event or a receive task a message flow reaches, a timer catch event, or a conditional catch event`,
      });
    }
  }
  return issues;
}

/** Whether `node` carries a standard loop marker only a boundary event could end, and has none that can: an
 * interrupting message, timer or error ends it between passes, while a condition is read once it is done, which it
 * never is, and an event that does not interrupt ends nothing. */
function repeatsForever(model: StudyModel, node: Element, boundaries: Element[]): boolean {
  const loop = node.loopCharacteristics;
  if (!isElement(loop) || loop.type !== 'bpmn:StandardLoopCharacteristics') return false;
  if (typeof loop.loopMaximum === 'number' || expressionOf(loop.loopCondition)) return false;
  const definitions = (boundary: Element): Element[] => (Array.isArray(boundary.eventDefinitions) ? boundary.eventDefinitions.filter(isElement) : []);
  const ends = (boundary: Element): boolean => {
    const error = definitions(boundary).some((definition) => model.isA(definition, 'bpmn:ErrorEventDefinition'));
    const conditional = definitions(boundary).some((definition) => model.isA(definition, 'bpmn:ConditionalEventDefinition'));
    return error || (!conditional && boundary.cancelActivity !== false && boundary.cancelActivity !== 'false');
  };
  return !boundaries.some(ends);
}
