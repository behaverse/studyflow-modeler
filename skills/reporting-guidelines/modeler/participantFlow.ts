/**
 * The path a participant takes through a study, read off its control flow and the counts a run left on it: who
 * entered, who left before allocation, the arms, who left each arm or the path the arms share, and who reached the
 * end. A guideline's participant flow (CONSORT's) words and draws this; none of it is CONSORT's own.
 *
 * It reads only these:
 * - the allocation gateway is the one whose schema type draws its branch (`meta.branching: random`), and each flow
 *   out of it is an arm;
 * - an eligibility screen is a gateway whose schema type has the `screening` role;
 * - before allocation, every way out that cannot come to the allocation gateway is an exclusion;
 * - after it, a participant leaves through a boundary event whose path never comes to a plain end event (BPMN's
 *   exception flow), or along a flow into an error end event; either may say what leaving there counts as
 *   (`reporting:attrition`), and unsaid, a timer is a loss to follow-up and anything else a discontinuation. A
 *   boundary event that says so counts even where its path goes on to the end: one who did not receive the
 *   intervention and is followed up all the same;
 * - a count is how often a token reached the element or followed the flow (`state._meta.reached`), 0 before any run.
 */
import { getCatalog, hasCatalog } from '@core/notation';
import { idOf, isElement, type Element, type StudyModel, type Value } from '@core/model/index';
import { resolvePlaceholdersIn, resolveStateIn } from '@core/model/state';
import { sentenceCase, withoutCount } from '@skills/reporting-guidelines/modeler/svg';

/** The kind of attrition a leaving counts as: an exclusion before allocation, one of the vocabulary's four after it. */
export type Attrition = 'excluded' | 'not-received' | 'lost-to-follow-up' | 'discontinued' | 'excluded-from-analysis';

const STATED: ReadonlySet<string> = new Set(['not-received', 'lost-to-follow-up', 'discontinued', 'excluded-from-analysis']);

/** The reason of an exit the diagram names nowhere. */
const UNSAID = 'Reason not given';

export type Exit = {
  /** The element whose count this is: the boundary event left through, or the flow taken out. */
  id: string;
  /** Why, in the diagram's own words: the name of the flow out, else of the event, else of the end it leads to. */
  reason: string;
  n: number;
  attrition: Attrition;
};

export type Arm = {
  /** The flow out of the allocation gateway. */
  id: string;
  name: string;
  allocated: number;
  /** Who started the arm's first activity and was not turned away from it; absent when the arm has no activity of its own. */
  received?: number;
  exits: Exit[];
  /** Who came to the study's end from this arm; absent when the arm joins the others before the end. */
  completed?: number;
};

/** Where a flow node sits on the path: before the allocation gateway, at it, in one arm, or past where arms join. */
export type Region = 'before' | 'allocation' | 'shared' | { arm: number };

export type ParticipantFlow = {
  /** The process, or sub-process, the allocation gateway sits in. */
  container: Element;
  allocation: Element;
  /** The eligibility screen before it, when the study draws one. */
  screening?: Element;
  entered: number;
  excluded: Exit[];
  allocated: number;
  arms: Arm[];
  /** Past where the arms' paths join. */
  shared: { exits: Exit[]; completed?: number };
  region(id: string): Region | undefined;
};

const listIn = (value: Value | undefined): Value[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

const definitionsOf = (element: Element): string[] => listIn(element.eventDefinitions).filter(isElement).map((definition) => definition.type);

const isTimer = (element: Element): boolean => definitionsOf(element).includes('bpmn:TimerEventDefinition');

const isErrorEnd = (element: Element): boolean => definitionsOf(element).includes('bpmn:ErrorEventDefinition');

function schemaTypeOf(model: StudyModel, element: Element) {
  const type = model.extensionType(element);
  return type && hasCatalog() ? getCatalog().getType(type) : undefined;
}

/** Whether `element`'s schema type has `role`, its own or inherited. */
export function hasRole(model: StudyModel, element: Element, role: string): boolean {
  return schemaTypeOf(model, element)?.roles.includes(role) ?? false;
}

/** How often a token reached `id`, an element or a flow; 0 where no run did. */
export function reached(model: StudyModel, id: string): number {
  const count = resolveStateIn(model, id, 'reached');
  return typeof count === 'number' ? count : 0;
}

/** An element's name as a document quotes it: placeholders filled, without its count, a capital first. */
export function nameOf(model: StudyModel, element: Element | undefined): string {
  if (!element || typeof element.name !== 'string' || typeof element.id !== 'string') return '';
  return sentenceCase(withoutCount(resolvePlaceholdersIn(model, element.name, element.id)));
}

/** The lane of `container` that lists `id`, the innermost where lanes nest. */
export function laneOf(container: Element, id: string): Element | undefined {
  const search = (laneSets: Value | undefined): Element | undefined => {
    for (const set of listIn(laneSets).filter(isElement)) {
      for (const lane of listIn(set.lanes).filter(isElement)) {
        const inner = search(lane.childLaneSet);
        if (inner) return inner;
        if (listIn(lane.flowNodeRef).some((ref) => idOf(ref) === id)) return lane;
      }
    }
    return undefined;
  };
  return search(container.laneSets);
}

/** `element`, or the element holding it, that sits directly in `container`; none when it is not inside. */
export function topLevelIn(model: StudyModel, container: Element, element: Element): Element | undefined {
  for (let at: Element | undefined = element; at; at = model.parentOf(at)) {
    if (model.parentOf(at) === container) return at;
  }
  return undefined;
}

type Flow = { id: string; element: Element; source: string; target: string };

/** The flow nodes of one container and how a token moves between them: along a sequence flow, or out of an activity
 * through a boundary event on it. */
class Graph {
  readonly nodes = new Map<string, Element>();
  readonly flows: Flow[] = [];
  private readonly forward = new Map<string, string[]>();
  private readonly along = new Map<string, string[]>();
  private readonly back = new Map<string, string[]>();

  constructor(model: StudyModel, container: Element) {
    const add = (map: Map<string, string[]>, from: string, to: string): void => { map.set(from, [...(map.get(from) ?? []), to]); };
    for (const item of listIn(container.flowElements).filter(isElement)) {
      if (typeof item.id !== 'string') continue;
      if (model.isA(item, 'bpmn:SequenceFlow')) {
        const source = idOf(item.sourceRef);
        const target = idOf(item.targetRef);
        if (source && target) this.flows.push({ id: item.id, element: item, source, target });
      } else if (model.isA(item, 'bpmn:FlowNode')) this.nodes.set(item.id, item);
    }
    for (const { source, target } of this.flows) {
      add(this.forward, source, target);
      add(this.along, source, target);
      add(this.back, target, source);
    }
    for (const [id, node] of this.nodes) {
      const host = model.isA(node, 'bpmn:BoundaryEvent') ? idOf(node.attachedToRef) : null;
      if (!host) continue;
      add(this.forward, host, id);
      add(this.back, id, host);
    }
  }

  private walk(from: string, edges: Map<string, string[]>): Set<string> {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length > 0) {
      for (const next of edges.get(stack.pop()!) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    return seen;
  }

  /** Where a token at `from` can come to, `from` included; `normal` follows sequence flows alone. */
  reach(from: string, normal = false): Set<string> {
    return this.walk(from, normal ? this.along : this.forward);
  }

  /** Where a token that comes to `to` can have been, `to` included. */
  origins(to: string): Set<string> {
    return this.walk(to, this.back);
  }
}

/** The attrition `element` states, if it is one of the vocabulary's. */
function stated(model: StudyModel, element: Element | undefined): Attrition | undefined {
  const value = element ? model.attribute(element, 'attrition') : undefined;
  return typeof value === 'string' && STATED.has(value) ? value as Attrition : undefined;
}

/** A screen's exclusion in CONSORT's words, with its one criterion when it lists exactly one. */
function screeningReason(model: StudyModel, screen: Element): string {
  const texts = (name: string): string[] => listIn(model.attribute(screen, name))
    .map((entry) => (typeof entry === 'string' ? entry : isElement(entry) && typeof entry.body === 'string' ? entry.body : ''))
    .map((text) => text.trim()).filter(Boolean);
  const inclusion = texts('inclusionCriteria');
  const exclusion = texts('exclusionCriteria');
  if (inclusion.length > 0 && exclusion.length > 0) return 'Not meeting eligibility criteria';
  if (exclusion.length > 0) return exclusion.length === 1 ? `Meeting exclusion criterion: ${exclusion[0]}` : 'Meeting exclusion criteria';
  return inclusion.length === 1 ? `Not meeting inclusion criterion: ${inclusion[0]}` : 'Not meeting inclusion criteria';
}

/**
 * The participant flow of the study, or nothing when it allocates no one at random: the first gateway, in the file's
 * order, whose schema type draws its branch and that has two flows or more out of it.
 */
export function participantFlowOf(model: StudyModel): ParticipantFlow | undefined {
  for (const allocation of model.elements()) {
    if (schemaTypeOf(model, allocation)?.meta.branching !== 'random') continue;
    const container = model.parentOf(allocation);
    if (!container || typeof allocation.id !== 'string') continue;
    const graph = new Graph(model, container);
    const armFlows = graph.flows.filter((flow) => flow.source === allocation.id);
    if (armFlows.length >= 2) return readFlow(model, container, allocation, graph, armFlows);
  }
  return undefined;
}

function readFlow(model: StudyModel, container: Element, allocation: Element, graph: Graph, armFlows: Flow[]): ParticipantFlow {
  const at = allocation.id!;
  const before = graph.origins(at);
  before.delete(at);
  const after = armFlows.map((flow) => graph.reach(flow.target));
  const armsAt = (id: string): number[] => after.flatMap((nodes, arm) => (nodes.has(id) ? [arm] : []));
  const region = (id: string): Region | undefined => {
    if (id === at) return 'allocation';
    if (before.has(id)) return 'before';
    const arms = armsAt(id);
    return arms.length === 0 ? undefined : arms.length === 1 ? { arm: arms[0] } : 'shared';
  };

  const flowsOut = (id: string): Flow[] => graph.flows.filter((flow) => flow.source === id);
  /** The end events a token at `id` can come to. */
  const endsFrom = (id: string): Element[] => [...graph.reach(id)].map((node) => graph.nodes.get(node))
    .filter((node): node is Element => !!node && model.isA(node, 'bpmn:EndEvent'));
  /** Why a participant left through `event`: the name of its one flow out, else its own, else, when its path goes
   * nowhere but out, of the end it leads to. */
  const reasonAt = (event: Element, out: boolean): string => {
    const flows = flowsOut(event.id!);
    return (flows.length === 1 ? nameOf(model, flows[0].element) : '') || nameOf(model, event) || (out ? nameOf(model, endsFrom(event.id!)[0]) : '') || UNSAID;
  };

  // Before allocation: whoever takes a way out that cannot come to the gateway was assessed and excluded.
  const screening = [...before].map((id) => graph.nodes.get(id)).find((node): node is Element => !!node && hasRole(model, node, 'screening'));
  const excluded: Exit[] = [];
  for (const item of listIn(container.flowElements).filter(isElement)) {
    const id = item.id;
    if (typeof id !== 'string') continue;
    const flow = graph.flows.find((candidate) => candidate.id === id);
    if (flow && before.has(flow.source) && flow.target !== at && !before.has(flow.target)) {
      const source = graph.nodes.get(flow.source);
      const reason = source && hasRole(model, source, 'screening')
        ? screeningReason(model, source)
        : nameOf(model, flow.element) || nameOf(model, graph.nodes.get(flow.target)) || UNSAID;
      excluded.push({ id, reason, n: reached(model, id), attrition: 'excluded' });
    } else if (graph.nodes.has(id) && model.isA(item, 'bpmn:BoundaryEvent') && !before.has(id) && before.has(idOf(item.attachedToRef) ?? '')) {
      excluded.push({ id, reason: reasonAt(item, true), n: reached(model, id), attrition: 'excluded' });
    }
  }

  // After it: the plain ends the normal flow comes to are where a participant completes; a boundary event whose
  // path never comes to one is a way out, and so is a flow into an error end event, or into an end that says so.
  const normal = graph.reach(at, true);
  const isExitEnd = (node: Element): boolean => isErrorEnd(node) || stated(model, node) !== undefined;
  const completions = new Set([...normal].filter((id) => {
    const node = graph.nodes.get(id);
    return !!node && model.isA(node, 'bpmn:EndEvent') && !isExitEnd(node);
  }));
  const completes = (id: string): boolean => [...graph.reach(id)].some((node) => completions.has(node));

  const arms: Arm[] = armFlows.map((flow) => ({
    id: flow.id,
    name: nameOf(model, flow.element) || nameOf(model, graph.nodes.get(flow.target)) || flow.id,
    allocated: reached(model, flow.id),
    exits: [],
  }));
  const shared: ParticipantFlow['shared'] = { exits: [] };
  const exitsOf = (where: Region | undefined): Exit[] | undefined => (where === 'shared' ? shared.exits : typeof where === 'object' ? arms[where.arm].exits : undefined);
  /** The activity each exit left, for the arm's count of who received its intervention. */
  const leftFrom = new Map<string, string>();

  for (const item of listIn(container.flowElements).filter(isElement)) {
    const id = item.id;
    if (typeof id !== 'string') continue;
    if (graph.nodes.has(id) && model.isA(item, 'bpmn:BoundaryEvent')) {
      const host = idOf(item.attachedToRef) ?? '';
      const exits = exitsOf(region(host));
      if (!exits || (stated(model, item) === undefined && completes(id))) continue;
      const ends = endsFrom(id);
      const attrition = stated(model, item) ?? (ends.length === 1 ? stated(model, ends[0]) : undefined) ?? (isTimer(item) ? 'lost-to-follow-up' : 'discontinued');
      exits.push({ id, reason: reasonAt(item, !completes(id)), n: reached(model, id), attrition });
      leftFrom.set(id, host);
      continue;
    }
    const flow = graph.flows.find((candidate) => candidate.id === id);
    const target = flow ? graph.nodes.get(flow.target) : undefined;
    if (!flow || !target || !normal.has(flow.source) || !model.isA(target, 'bpmn:EndEvent') || !isExitEnd(target)) continue;
    const exits = exitsOf(flow.source === at ? { arm: armFlows.indexOf(flow) } : region(flow.source));
    if (!exits) continue;
    exits.push({ id, reason: nameOf(model, flow.element) || nameOf(model, target) || UNSAID, n: reached(model, id), attrition: stated(model, target) ?? 'discontinued' });
    leftFrom.set(id, flow.source);
  }

  // Who received the arm's intervention: who started its first activity, less those turned away from it.
  const isActivity = (node: Element | undefined): boolean => !!node && (model.isA(node, 'bpmn:Activity') || model.isA(node, 'bpmn:ChoreographyActivity'));
  armFlows.forEach((flow, index) => {
    const own = [...graph.reach(flow.target, true)].filter((id) => armsAt(id).length === 1);
    const first = own.find((id) => isActivity(graph.nodes.get(id)));
    if (!first) return;
    const turnedAway = arms[index].exits.filter((exit) => exit.attrition === 'not-received' && leftFrom.get(exit.id) === first);
    arms[index].received = reached(model, first) - turnedAway.reduce((sum, exit) => sum + exit.n, 0);
  });

  // Who completed: the tokens that followed a flow into a completion, counted where that flow leaves from.
  for (const flow of graph.flows) {
    if (!completions.has(flow.target)) continue;
    const where = flow.source === at ? { arm: armFlows.indexOf(flow) } : region(flow.source);
    if (where === 'shared') shared.completed = (shared.completed ?? 0) + reached(model, flow.id);
    else if (typeof where === 'object') arms[where.arm].completed = (arms[where.arm].completed ?? 0) + reached(model, flow.id);
  }

  const allocated = reached(model, at);
  const starts = [...before].map((id) => graph.nodes.get(id)).filter((node): node is Element => !!node && model.isA(node, 'bpmn:StartEvent'));
  const entered = starts.length > 0
    ? starts.reduce((sum, start) => sum + reached(model, start.id!), 0)
    : allocated + excluded.reduce((sum, exit) => sum + exit.n, 0);

  return { container, allocation, screening, entered, excluded, allocated, arms, shared, region };
}
