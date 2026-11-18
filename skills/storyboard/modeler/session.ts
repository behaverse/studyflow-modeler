/**
 * The session one participant goes through, as the storyboard tells it: from the study's start event along its
 * sequence flows, a choice taking its default flow (else its first), each step once, with when it begins and how long
 * it lasts. A collaboration's session is its participant's pool: the one a human plays, else the first with a process.
 */

import { BPMN } from '@core/constants';
import { graphOf, type GraphNode } from '@core/checks/graph';
import { documentationOf, idOf, isElement, type Element, type StudyModel } from '@core/model/index';
import { durationOf, parseDurationMin } from '@modeler/schedule/rows';

export type SessionStep = {
  id: string;
  name: string;
  /** Its BPMN type, and the schema type extending it. */
  type: string;
  extension?: string;
  description?: string;
  /** Its length as written, and in minutes when it reads as one. */
  duration?: string;
  minutes?: number;
  /** When it begins, in minutes from the start: the lengths before it that are known. */
  at: number;
  /** The sequence flow it is reached by, from the step before. */
  via?: string;
  /** How many ways lead on from it, when more than one: a choice. */
  ways?: number;
};

export type Session = {
  steps: SessionStep[];
  /** Minutes, summed over the lengths that are known. */
  total: number;
  /** The tasks that state no length. */
  unknown: number;
};

/** The process the participant goes through. */
function sessionProcess(model: StudyModel): Element | undefined {
  const root = model.primaryRoot();
  if (!root) return undefined;
  if (model.isA(root, BPMN.FlowElementsContainer)) return root;
  const pools = (Array.isArray(root.participants) ? root.participants.filter(isElement) : [])
    .map((pool) => ({ pool, process: model.get(idOf(pool.processRef) ?? undefined) }))
    .filter((entry): entry is { pool: Element; process: Element } => !!entry.process);
  const human = pools.find(({ pool }) => [undefined, null, '', 'human'].includes(model.attribute(pool, 'actorType') as string | undefined));
  return (human ?? pools[0])?.process;
}

const isStep = (model: StudyModel, element: Element): boolean =>
  ['bpmn:Task', 'bpmn:CallActivity', 'bpmn:SubProcess', 'bpmn:ChoreographyActivity'].some((type) => model.isA(element, type));

export function sessionOf(model: StudyModel): Session {
  const process = sessionProcess(model);
  const session: Session = { steps: [], total: 0, unknown: 0 };
  if (!process) return session;
  const { nodes } = graphOf(model, process);
  const nodeOf = (ref: unknown): GraphNode | undefined => {
    const element = model.get(idOf(ref as Element['id']) ?? undefined);
    return element ? nodes.get(element) : undefined;
  };
  const all = [...nodes.values()];
  let current = all.find(({ node }) => model.isA(node, BPMN.StartEvent) && !model.isA(node, BPMN.BoundaryEvent));
  let via: string | undefined;
  const seen = new Set<GraphNode>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const element = current.node;
    const duration = durationOf(model, element);
    const minutes = duration === undefined ? undefined : parseDurationMin(duration);
    const description = documentationOf(element)?.trim();
    session.steps.push({
      id: String(element.id),
      name: typeof element.name === 'string' ? element.name : '',
      type: element.type,
      ...(model.extensionType(element) ? { extension: model.extensionType(element) } : {}),
      ...(description ? { description } : {}),
      ...(duration ? { duration } : {}),
      ...(minutes !== undefined ? { minutes } : {}),
      at: session.total,
      ...(via ? { via } : {}),
      ...(current.outgoing.length > 1 ? { ways: current.outgoing.length } : {}),
    });
    if (minutes !== undefined) session.total += minutes;
    else if (isStep(model, element)) session.unknown += 1;
    const chosen = idOf(element.default as Element['id']);
    const next = current.outgoing.find((flow) => flow.id === chosen) ?? current.outgoing[0];
    via = next?.id === undefined ? undefined : String(next.id);
    current = next ? nodeOf(next.targetRef) : undefined;
  }
  return session;
}

/** Minutes as a person says them: `45 min`, `1 h 30 min`, `2 d`, `30 s`. */
export function spokenMinutes(minutes: number): string {
  if (minutes === 0) return '0 min';
  if (minutes < 1) return `${Math.round(minutes * 60)} s`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = Math.round(minutes % 60);
  return [days && `${days} d`, hours && `${hours} h`, rest && `${rest} min`].filter(Boolean).join(' ') || '0 min';
}

/** A length as the storyboard shows it: as written, unless it is ISO 8601 (`PT1H`), which it says in words. */
export function spokenLength(step: Pick<SessionStep, 'duration' | 'minutes'>): string | undefined {
  if (!step.duration) return undefined;
  return /^p/i.test(step.duration) && step.minutes !== undefined ? spokenMinutes(step.minutes) : step.duration;
}
