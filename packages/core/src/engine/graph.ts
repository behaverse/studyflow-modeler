import type { Plan, PlanElement } from '@core/engine/plan';

export const DATA_TYPES = new Set(['dataObjectReference', 'dataStoreReference', 'dataObject', 'dataStore', 'property']);
export const GATEWAY_TYPES = new Set(['exclusiveGateway', 'inclusiveGateway', 'complexGateway', 'eventBasedGateway']);
export const CONTAINER_TYPES = new Set(['subProcess', 'adHocSubProcess', 'transaction']);
export const PASSTHROUGH_TYPES = new Set(['startEvent', 'intermediateCatchEvent', 'intermediateThrowEvent']);

/** What a container holds that no sequence flow leads to. */
export const NOT_FLOW_NODES = new Set([...DATA_TYPES, 'sequenceFlow', 'boundaryEvent', 'textAnnotation', 'association', 'group']);

/** A property's initial value, which the walk reads as a {@link literal}. */
export const PROPERTY_VALUE = 'studyflow:value';

/** A `value` or `seed` attribute: JSON when it parses, else the text as written. */
export function literal(text: unknown): unknown {
  if (typeof text !== 'string') return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** How the XML holds a property's value, the text {@link literal} reads back as it: a text JSON does not parse as it is,
 * anything else as its JSON (a number, a truth value, a list, a mapping, and a text such as `"0.2"` that JSON would read
 * as a number). */
export function literalText(value: unknown): string {
  return typeof value === 'string' && literal(value) === value ? value : JSON.stringify(value);
}

/** A property a scope declares: its initial value (`undefined` when it declares none), and its element's id. */
export type Declared = { value: unknown; id?: string };

/**
 * A plan as the walk reads it: each element's container and sequence flows, the properties each scope declares, the
 * message flows by the element or participant at each end, and the boundary events by the activity each sits on.
 */
export class Graph {
  readonly elements: Record<string, PlanElement>;
  readonly outgoing = new Map<string, PlanElement[]>();
  readonly incoming = new Map<string, PlanElement[]>();
  readonly children = new Map<string, PlanElement[]>();
  /** Lexical scopes: the properties each declares, by name. */
  readonly properties = new Map<string, Map<string, Declared>>();
  /** The properties the Parameters wired into a sub-process set: nothing inside it writes them. */
  readonly readonly = new Map<string, Set<string>>();
  readonly participants = new Map<string, PlanElement>();
  readonly flowsOut = new Map<string, PlanElement[]>();
  readonly flowsIn = new Map<string, PlanElement[]>();
  readonly boundaries = new Map<string, PlanElement[]>();
  /** The elements of the walked processes: what a name may cite and a scope may hold. */
  readonly walked = new Set<string>();

  readonly plan: Plan;

  constructor(plan: Plan) {
    this.plan = plan;
    this.elements = plan.elements;
    const push = (map: Map<string, PlanElement[]>, key: string | undefined, element: PlanElement): void => {
      if (key) map.set(key, [...(map.get(key) ?? []), element]);
    };
    const declare = (scope: string, name: string, declared: Declared): void => {
      if (!this.properties.has(scope)) this.properties.set(scope, new Map());
      this.properties.get(scope)!.set(name, declared);
    };
    for (const element of Object.values(plan.elements)) {
      if (element.parent !== undefined) {
        this.walked.add(element.id);
        push(this.children, element.parent ?? undefined, element);
      }
      if (element.type === 'sequenceFlow') {
        push(this.outgoing, element.attributes.sourceRef, element);
        push(this.incoming, element.attributes.targetRef, element);
      }
      else if (element.type === 'participant') this.participants.set(element.id, element);
      else if (element.type === 'messageFlow') {
        push(this.flowsOut, element.attributes.sourceRef, element);
        push(this.flowsIn, element.attributes.targetRef, element);
      } else if (element.type === 'boundaryEvent') push(this.boundaries, element.attributes.attachedToRef, element);
      if (element.type === 'property' && element.parent) {
        declare(element.parent, element.name || element.id, { value: literal(element.attributes.value), id: element.id });
      }
      // The item a pass over a list binds is a property of the activity, with no value of its own.
      if (element.loop?.kind === 'multiInstance' && element.loop.inputItem) declare(element.id, element.loop.inputItem, { value: undefined });
    }
    // The Parameters wired into a sub-process are read-only properties of it, beside the ones it declares.
    for (const element of Object.values(plan.elements)) {
      if (!CONTAINER_TYPES.has(element.type)) continue;
      for (const [name, value] of Object.entries(element.parameters ?? {})) {
        if (this.properties.get(element.id)?.has(name)) {
          throw new Error(`${element.id} declares '${name}' as a property and in the Parameters wired into it: keep one.`);
        }
        declare(element.id, name, { value });
        this.readonly.set(element.id, new Set([...(this.readonly.get(element.id) ?? []), name]));
      }
    }
  }

  get(id: string | undefined | null): PlanElement | undefined {
    return id ? this.elements[id] : undefined;
  }

  nameOf(id: string): string {
    return this.elements[id]?.name || id;
  }

  /** Whether a token at `from` may still come to `to` along sequence flows, an activity's boundary events included. */
  reaches(from: string, to: string): boolean {
    const key = `${from}>${to}`;
    let known = this.reach.get(key);
    if (known === undefined) {
      const seen = new Set<string>();
      const queue = [from];
      known = false;
      while (queue.length > 0 && !known) {
        const at = queue.shift()!;
        if (at === to) known = true;
        else if (!seen.has(at)) {
          seen.add(at);
          for (const flow of this.outgoing.get(at) ?? []) if (flow.attributes.targetRef) queue.push(flow.attributes.targetRef);
          for (const boundary of this.boundaries.get(at) ?? []) queue.push(boundary.id);
        }
      }
      this.reach.set(key, known);
    }
    return known;
  }

  private readonly reach = new Map<string, boolean>();

  /** Whether `element` joins paths: a parallel or inclusive gateway more than one sequence flow comes into. */
  joins(element: PlanElement): boolean {
    return (element.type === 'parallelGateway' || element.type === 'inclusiveGateway') && (this.incoming.get(element.id) ?? []).length > 1;
  }

  /** The element, then its containers outward to the process. */
  scopeChain(id: string): string[] {
    const chain = [id];
    for (let parent = this.elements[id]?.parent; parent; parent = this.elements[parent]?.parent) chain.push(parent);
    return chain;
  }

  /** The participant whose pool depicts a process, if one does. */
  participantOf(process: string): string | undefined {
    return [...this.participants.values()].find((participant) => participant.attributes.processRef === process)?.id;
  }

  /** The process an element belongs to, or that a participant depicts; a participant with none is its own pool. */
  poolOf(end: string): string {
    const participant = this.participants.get(end);
    if (participant) return participant.attributes.processRef || end;
    const chain = this.scopeChain(end);
    return chain[chain.length - 1];
  }

  /** The pool depicting a process and how many instances of it run: BPMN's `participantMultiplicity/@maximum`. */
  instancesOf(process: string): { participant: string; instances: number } {
    const pool = this.get(this.participantOf(process));
    return { participant: pool?.id ?? process, instances: Math.max(1, pool?.multiplicity ?? 1) };
  }

  startEvent(container: string): PlanElement | undefined {
    return (this.children.get(container) ?? []).find((element) => element.type === 'startEvent');
  }

  /** Where a process starts: its start event; one that leaves it out (BPMN 2.0 §10.2) starts at the one node
   * nothing flows into. */
  entryOf(process: string): PlanElement {
    const start = this.startEvent(process);
    if (start) return start;
    const targets = new Set([...this.outgoing.values()].flat().map((flow) => flow.attributes.targetRef));
    const entries = (this.children.get(process) ?? [])
      .filter((element) => !NOT_FLOW_NODES.has(element.type) && !targets.has(element.id));
    if (entries.length !== 1) throw new Error(`no start event in ${process}`);
    return entries[0];
  }

  /** A data element's `uri`, if it is one and has one. */
  uriOf(id: string): string | undefined {
    const element = this.elements[id];
    return element && DATA_TYPES.has(element.type) ? element.attributes.uri || undefined : undefined;
  }

  /** (scope, name) when the element is a property its scope declares. */
  propertyScope(id: string): { scope: string; name: string } | undefined {
    const element = this.elements[id];
    if (element?.type !== 'property' || !element.parent) return undefined;
    const name = element.name || id;
    return this.properties.get(element.parent)?.has(name) ? { scope: element.parent, name } : undefined;
  }

  /**
   * Whose message flows a step exchanges along: its own, else the nearest enclosing sub-process that has some, else
   * its pool's. A collapsed sub-process is the only place BPMN can draw a message flow to a step inside it, and a
   * pool's flows are the whole pool's, lanes and all, so a step inside one talks along them. A step with flows of its
   * own inherits none.
   */
  messageScope(id: string): string {
    const talks = (scope: string): boolean => this.flowsIn.has(scope) || this.flowsOut.has(scope);
    let scope = id;
    while (!talks(scope)) {
      const container = this.get(this.elements[scope]?.parent);
      if (!container || !CONTAINER_TYPES.has(container.type)) {
        const pool = this.participantOf(this.poolOf(id)) ?? '';
        return talks(pool) ? pool : id;
      }
      scope = container.id;
    }
    return scope;
  }

  /**
   * Where an activity no runner claims talks, and along which flows out and in: its own; else, when it has data
   * inputs to send, its sub-process's or pool's ({@link messageScope}), but only their talk with other pools, never
   * a pool's once-only message to a step elsewhere. A step with nothing to send asks nothing.
   */
  exchange(element: PlanElement): { scope: string; outgoing: PlanElement[]; incoming: PlanElement[] } {
    const scope = this.messageScope(element.id);
    const outgoing = this.flowsOut.get(scope) ?? [];
    const incoming = this.flowsIn.get(scope) ?? [];
    if (scope === element.id) return { scope, outgoing, incoming };
    if (element.inputs.length === 0) return { scope, outgoing: [], incoming: [] };
    return {
      scope,
      outgoing: outgoing.filter((flow) => this.participants.has(flow.attributes.targetRef)),
      incoming: incoming.filter((flow) => this.participants.has(flow.attributes.sourceRef)),
    };
  }
}
