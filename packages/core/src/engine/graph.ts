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
 * data stores, the message flows by the element or participant at each end, and the boundary events by the activity
 * each sits on.
 */
export class Graph {
  readonly elements: Record<string, PlanElement>;
  readonly outgoing = new Map<string, PlanElement[]>();
  readonly incoming = new Map<string, PlanElement[]>();
  readonly children = new Map<string, PlanElement[]>();
  /** Lexical scopes: the properties each declares, by name. */
  readonly properties = new Map<string, Map<string, Declared>>();
  /** The data stores, by name to id: each one value for the whole study, under its id in the state. */
  readonly stores = new Map<string, string>();
  /** The properties the Parameters wired into a sub-process set: nothing inside it writes them. */
  readonly readonly = new Map<string, Set<string>>();
  readonly participants = new Map<string, PlanElement>();
  readonly flowsOut = new Map<string, PlanElement[]>();
  readonly flowsIn = new Map<string, PlanElement[]>();
  readonly boundaries = new Map<string, PlanElement[]>();
  /** The elements of the walked processes: what a name may cite and a scope may hold. */
  readonly walked = new Set<string>();
  /** The processes call activities call, each with the call activities that call it, in the order drawn. */
  readonly callers = new Map<string, PlanElement[]>();

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
      if (element.type === 'dataStore') {
        const name = element.name || element.id;
        const other = this.stores.get(name);
        if (other) throw new Error(`${other} and ${element.id} are both data stores named '${name}': rename one.`);
        this.stores.set(name, element.id);
      }
      // The item a pass over a list binds is a property of the activity, with no value of its own.
      if (element.loop?.kind === 'multiInstance' && element.loop.inputItem) declare(element.id, element.loop.inputItem, { value: undefined });
    }
    const called = new Set(plan.called ?? []);
    for (const element of Object.values(plan.elements)) {
      const process = element.type === 'callActivity' ? element.attributes.calledElement : undefined;
      if (process && called.has(process)) push(this.callers, process, element);
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

  /** The process an element belongs to, or that a participant depicts; a participant with none is its own pool. An
   * element of a process a call activity calls belongs to the pool of the first activity calling it. */
  poolOf(end: string): string {
    const participant = this.participants.get(end);
    if (participant) return participant.attributes.processRef || end;
    const top = (id: string): string => {
      const chain = this.scopeChain(id);
      return chain[chain.length - 1];
    };
    let process = top(end);
    const seen = new Set<string>();
    for (let caller = this.callerOf(process); caller && !seen.has(process); caller = this.callerOf(process)) {
      seen.add(process);
      process = top(caller);
    }
    return process;
  }

  /** The process a call activity calls, when the study has it: one walked in the activity's place. */
  callee(element: PlanElement | undefined): string | undefined {
    const process = element?.type === 'callActivity' ? element.attributes.calledElement : undefined;
    return process && this.callers.has(process) ? process : undefined;
  }

  /** The first call activity that calls `process`, when no pool depicts it. */
  private callerOf(process: string): string | undefined {
    return this.plan.processes.includes(process) ? undefined : this.callers.get(process)?.[0]?.id;
  }

  /** The activities a step may run inside, innermost first: its containers, and out of a process a call activity
   * calls, that activity and what is around it. */
  enclosing(id: string): string[] {
    const around: string[] = [];
    const seen = new Set<string>();
    const visit = (from: string): void => {
      for (const scope of this.scopeChain(from).slice(1)) {
        if (this.elements[scope]) around.push(scope);
        for (const caller of this.elements[scope] ? [] : this.callers.get(scope) ?? []) {
          if (seen.has(caller.id)) continue;
          seen.add(caller.id);
          around.push(caller.id);
          visit(caller.id);
        }
      }
    };
    visit(id);
    return around;
  }

  /** The pool depicting a process and how many instances of it run: BPMN's `participantMultiplicity/@maximum`. */
  instancesOf(process: string): { participant: string; instances: number } {
    const pool = this.get(this.participantOf(process));
    return { participant: pool?.id ?? process, instances: Math.max(1, pool?.multiplicity ?? 1) };
  }

  startEvent(container: string): PlanElement | undefined {
    return (this.children.get(container) ?? []).find((element) => element.type === 'startEvent');
  }

  /** Where a process or sub-process starts (BPMN 2.0 §10.5.2): at its start event, the first when it has several; one
   * that has none starts at every flow node nothing flows into, in the order drawn, but for an event sub-process and
   * an activity drawn for compensation. A scope with nothing inside it starts nowhere, and so ends at once. */
  entriesOf(container: string): PlanElement[] {
    const start = this.startEvent(container);
    if (start) return [start];
    return (this.children.get(container) ?? []).filter((element) => !NOT_FLOW_NODES.has(element.type)
      && !this.incoming.get(element.id)?.length
      && element.attributes.triggeredByEvent !== 'true' && element.attributes.isForCompensation !== 'true');
  }

  /** A data element's `uri`, if it is one and has one; a data store reference without one has its data store's. */
  uriOf(id: string): string | undefined {
    const element = this.elements[id];
    if (!element || !DATA_TYPES.has(element.type)) return undefined;
    const store = this.storeOf(id);
    return element.attributes.uri || (store && store !== id ? this.elements[store].attributes.uri : undefined) || undefined;
  }

  /** The references that show a data store, by its id. */
  referencesOf(store: string): string[] {
    if (!this.shown) {
      this.shown = new Map();
      for (const element of Object.values(this.elements)) {
        const named = element.type === 'dataStoreReference' ? this.storeOf(element.id) : undefined;
        if (named) this.shown.set(named, [...(this.shown.get(named) ?? []), element.id]);
      }
    }
    return this.shown.get(store) ?? [];
  }

  private shown?: Map<string, string[]>;

  /** (scope, name) when the element is a property its scope declares. */
  propertyScope(id: string): { scope: string; name: string } | undefined {
    const element = this.elements[id];
    if (element?.type !== 'property' || !element.parent) return undefined;
    const name = element.name || id;
    return this.properties.get(element.parent)?.has(name) ? { scope: element.parent, name } : undefined;
  }

  /** The data store an element stands for: itself, or the one a data store reference names. */
  storeOf(id: string | undefined | null): string | undefined {
    const element = this.get(id);
    const store = element?.type === 'dataStoreReference' ? this.get(element.attributes.dataStoreRef) : element;
    return store?.type === 'dataStore' ? store.id : undefined;
  }

  /** A data store's initial value, `undefined` when it declares none. */
  storeValue(id: string): unknown {
    return literal(this.elements[id]?.attributes.value);
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
      // A step at the top of a process a call activity calls talks as a step inside that activity would.
      const parent = this.elements[scope]?.parent ?? '';
      const container = this.get(parent) ?? this.get(this.callerOf(parent));
      if (!container || !(CONTAINER_TYPES.has(container.type) || container.type === 'callActivity')) {
        const pool = this.participantOf(this.poolOf(id)) ?? '';
        return talks(pool) ? pool : id;
      }
      scope = container.id;
    }
    return scope;
  }

  /**
   * Where an activity no runner claims talks, and along which flows out and in: its own drawn ones; else, when it has
   * data inputs to send, those its band stands for (plan.ts, `bandExchanges`), or its sub-process's or pool's
   * ({@link messageScope}), but only their talk with other pools, never a pool's once-only message to a step
   * elsewhere. A step with nothing to send asks nothing.
   */
  exchange(element: PlanElement): { scope: string; outgoing: PlanElement[]; incoming: PlanElement[] } {
    const scope = this.messageScope(element.id);
    const outgoing = this.flowsOut.get(scope) ?? [];
    const incoming = this.flowsIn.get(scope) ?? [];
    const banded = [...outgoing, ...incoming].every((flow) => flow.attributes.band === element.id);
    if (scope === element.id && banded && element.inputs.length === 0) return { scope, outgoing: [], incoming: [] };
    if (scope === element.id) return { scope, outgoing, incoming };
    if (element.inputs.length === 0) return { scope, outgoing: [], incoming: [] };
    return {
      scope,
      outgoing: outgoing.filter((flow) => this.participants.has(flow.attributes.targetRef)),
      incoming: incoming.filter((flow) => this.participants.has(flow.attributes.sourceRef)),
    };
  }
}
