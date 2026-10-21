import { BPMN } from '@core/constants';
import type { Issue } from '@core/checks';
import { containers, quoted } from '@core/checks/graph';
import { isAnsweringPool, isTypedChoreography } from '@core/model/choreography';
import { idOf, isElement, type Element, type StudyModel } from '@core/model/index';

/**
 * Whom a typed choreography task exchanges with (a cognitive task, a questionnaire). In a study with a pool a program
 * answers (a model, a simulated actor), a task names who answers it on its band (`participantRef`), or draws the
 * message flows its exchange goes along, its own or a sub-process's or its pool's: one that does neither would reach
 * no one, and a local run would stop at it, so it is refused here. A task whose band names that pool exchanges with
 * it as the message flows would carry it, and needs none drawn (packages/core/src/engine/plan.ts, `bandExchanges`).
 */
export function checkExchanges(model: StudyModel): Issue[] {
  const all = [...model.all()];
  const answering = all.filter((element) => model.isA(element, BPMN.Participant) && isAnsweringPool(model, element));
  if (answering.length === 0) return [];
  const ends = new Set(all.filter((element) => model.isA(element, BPMN.MessageFlow))
    .flatMap((flow) => [idOf(flow.sourceRef), idOf(flow.targetRef)]).filter((id): id is string => !!id));
  const poolOf = (process: Element): string | undefined => all
    .find((participant) => model.isA(participant, BPMN.Participant) && idOf(participant.processRef) === process.id)?.id;
  // A step talks along its own flows, else its sub-process's, else its pool's.
  const talks = (task: Element): boolean => {
    for (let at: Element | undefined = task; at; at = model.parentOf(at)) {
      if (at.id && ends.has(at.id)) return true;
      if (model.isA(at, BPMN.Process)) return ends.has(poolOf(at) ?? '');
    }
    return false;
  };
  const issues: Issue[] = [];
  const names = answering.map(quoted).join(', ');
  for (const container of containers(model)) {
    const elements = Array.isArray(container.flowElements) ? container.flowElements.filter(isElement) : [];
    for (const task of elements) {
      if (model.host(task) !== BPMN.ChoreographyTask || !isTypedChoreography(model, task)) continue;
      const band = Array.isArray(task.participantRef) ? task.participantRef.map(idOf).filter(Boolean) : [];
      // A step with nothing to send asks nothing (packages/runtime-local/WALK.md, "Messages").
      const sends = Array.isArray(task.dataInputAssociations) && task.dataInputAssociations.length > 0;
      if (!sends || band.length > 0 || talks(task)) continue;
      issues.push({
        severity: 'error',
        elementId: task.id,
        message: `${quoted(task)} exchanges with no one: it names no one on its band and no message flow reaches it, its sub-process or its pool, so its trials would go nowhere. Put the actor who answers it (${names}) on its band (participantRef), or draw the message flows its exchange goes along`,
      });
    }
  }
  return issues;
}
