import { BPMN } from '@core/constants';
import type { Issue } from '@core/checks';
import { containers, graphOf, quoted } from '@core/checks/graph';
import { Graph } from '@core/engine/graph';
import { planOf } from '@core/engine/plan';
import { expressionOf, idOf, isElement, type Element, type StudyModel, type Value } from '@core/model/index';

const list = (value: Value | undefined): Element[] => (Array.isArray(value) ? value.filter(isElement) : []);

/**
 * What the walk does not implement yet (docs/developers.qmd, "Where a run departs from BPMN 2.0"), each of which a run
 * reads otherwise than BPMN: a non-interrupting boundary event, which interrupts; an event-based gateway with a branch
 * no message reaches, which stops the run; a conditional catch or start event, which passes at once; an error a
 * boundary event names, an error boundary event on a sub-process with no error end event in it, and an error end event
 * an outer activity should catch; a sub-process stepped past, or an ad-hoc one walked as a plain one; a
 * `completionCondition`; and a call activity. The event-based gateway stops the run, so it is an error; the rest warn.
 */
export function checkUnimplemented(model: StudyModel): Issue[] {
  const issues: Issue[] = [];
  const warn = (element: Element, message: string): void => { issues.push({ severity: 'warning', elementId: element.id, message }); };
  const definitions = (event: Element, type: string): Element[] => list(event.eventDefinitions).filter((definition) => model.isA(definition, type));
  const isError = (event: Element): boolean => definitions(event, 'bpmn:ErrorEventDefinition').length > 0;

  // The boundary events on each activity, across every container, so an error end event can look outward.
  const boundariesOf = new Map<Element, Element[]>();
  for (const container of containers(model)) {
    for (const { node, boundaries } of graphOf(model, container).nodes.values()) boundariesOf.set(node, boundaries);
  }
  const caughtAt = (activity: Element): boolean => (boundariesOf.get(activity) ?? []).some(isError);

  for (const container of containers(model)) {
    const { flows, nodes } = graphOf(model, container);
    for (const { node } of nodes.values()) {
      if (model.isA(node, BPMN.BoundaryEvent)) {
        const activity = model.get(idOf(node.attachedToRef) ?? undefined);
        const on = activity ? quoted(activity) : 'its activity';
        if (node.cancelActivity === false || node.cancelActivity === 'false') {
          warn(node, `${quoted(node)} is a non-interrupting boundary event, which the walk does not implement yet: it ends ${on} as an interrupting one would; to keep the activity going, draw the wait as a catch event on a parallel path beside it`);
        }
        if (definitions(node, 'bpmn:ErrorEventDefinition').some((definition) => idOf(definition.errorRef))) {
          warn(node, `${quoted(node)} names the error it catches, which the walk does not compare yet: it catches every failure of ${on}`);
        }
        if (activity && model.isA(activity, BPMN.SubProcess) && isError(node)
          && !list(activity.flowElements).some((inside) => model.isA(inside, BPMN.EndEvent) && isError(inside))) {
          warn(node, `${quoted(node)} is never taken: the walk ends ${on} at an error boundary event only for an error end event directly inside it, which it has none of, and a step that fails inside it fails the run; put the error boundary event on the step that may fail`);
        }
        continue;
      }
      if ((model.isA(node, BPMN.IntermediateCatchEvent) || model.isA(node, BPMN.StartEvent)) && definitions(node, 'bpmn:ConditionalEventDefinition').length > 0) {
        warn(node, `${quoted(node)} is a conditional ${model.isA(node, BPMN.StartEvent) ? 'start' : 'catch'} event, whose condition the walk does not read yet: it passes at once, unless a runner claims it; put the condition on a conditional boundary event of the step that writes what it reads, or on an exclusive gateway after that step`);
      }
      // The sub-process around an error end event catches it at its own error boundary event, or nothing does: the walk
      // carries an error no further out, so an outer activity's error boundary event never sees it. One at the top of a
      // process, which BPMN leaves to the engine, ends its path as a plain end event does.
      if (model.isA(node, BPMN.EndEvent) && isError(node) && !caughtAt(container)) {
        for (let outer = model.parentOf(container); outer; outer = model.parentOf(outer)) {
          if (!caughtAt(outer)) continue;
          warn(node, `${quoted(node)} is an error end event ${quoted(container)} does not catch, and the walk does not carry an error out further yet, so ${quoted(outer)} does not catch it either: it ends its path as a plain end event does; catch it on ${quoted(container)}, and throw it on from there`);
          break;
        }
      }
      const marker = node.loopCharacteristics;
      if (isElement(marker) && model.isA(marker, 'bpmn:MultiInstanceLoopCharacteristics') && expressionOf(marker.completionCondition)) {
        warn(node, `${quoted(node)} carries a completionCondition, which the walk does not read yet: every instance runs; to stop early, use a standard loop marker whose loopCondition says when`);
      }
      if (model.isA(node, BPMN.CallActivity)) {
        const called = model.get(typeof node.calledElement === 'string' ? node.calledElement : idOf(node.calledElement) ?? undefined);
        const runs = called && model.isA(called, 'bpmn:Process') && list(called.flowElements).some((inside) => model.isA(inside, BPMN.SequenceFlow))
          ? `, and ${quoted(called)} runs on its own, as a pool` : '';
        warn(node, `${quoted(node)} is a call activity, which the walk does not implement yet: it calls nothing and passes as a task a runner may claim${runs}; draw the process as a sub-process here`);
      }
    }
    if (!model.isA(container, BPMN.SubProcess)) continue;
    const steps = [...nodes.values()].filter(({ node }) => !model.isA(node, BPMN.BoundaryEvent));
    if (steps.length === 0) continue;
    const started = steps.some(({ node }) => model.isA(node, BPMN.StartEvent));
    const adHoc = model.isA(container, 'bpmn:AdHocSubProcess');
    if (!started && flows.length === 0) {
      warn(container, `${quoted(container)} has no start event, so the walk steps past it and nothing inside it runs${adHoc ? ': it does not implement ad-hoc sub-processes yet' : ''}; give it a start event and sequence flows`);
    } else if (adHoc && started) {
      warn(container, `${quoted(container)} is an ad-hoc sub-process, which the walk does not implement yet: it walks it as a plain sub-process, from its start event`);
    }
    if (adHoc && expressionOf(container.completionCondition)) {
      warn(container, `${quoted(container)} carries a completionCondition, which the walk does not read yet: it ends when its last path ends`);
    }
  }

  // An event-based gateway takes the branch whose message comes first, and stops the run when a branch starts where no
  // message flow arrives (a timer or a conditional event). Read off the plan, whose message flows include the ones a
  // task's band stands for.
  let graph: Graph;
  try {
    graph = new Graph(planOf(model));
  } catch {
    return issues; // a study the walk cannot plan is reported by the other checks
  }
  const named = (id: string): string => `"${graph.elements[id]?.name || id}"`;
  for (const id of graph.walked) {
    if (graph.elements[id].type !== 'eventBasedGateway') continue;
    for (const flow of graph.outgoing.get(id) ?? []) {
      const target = flow.attributes.targetRef;
      if (!target || graph.flowsIn.has(target)) continue;
      issues.push({
        severity: 'error',
        elementId: id,
        message: `${named(id)} is an event-based gateway, which waits for messages only, and ${named(target)} takes none, so the run stops here; start each branch with a catch event or a receive task a message flow reaches, and draw a timeout as a timer boundary event on the receive task`,
      });
    }
  }
  return issues;
}
