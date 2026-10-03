import { looksLikeXml, xmlToStudy } from '@core/document';
import { PLACEHOLDER, type StateTree } from '@core/model/state';
import { BPMN } from '@core/constants';
import { literal, planOf, type Plan } from '@core/engine';
import { StudyModel, idOf, isElement, type Element, type Value } from '@core/model/index';
import { metamodelOf } from '@core/model/packages';
import { hasPath, mergeParameters, parametersIn, splitIn } from '@core/model/parameters';
import { readStudy } from '@core/model/yaml';
import type { FlowNode, SequenceFlow } from '@runner/flow';

/** What a run can reach besides tasks (every `bpmn:Task` subtype is one); anything else in the process is ignored. */
const FLOW_NODE_TYPES: ReadonlySet<string> = new Set<string>([
  BPMN.StartEvent,
  BPMN.EndEvent,
  BPMN.ChoreographyTask,
  BPMN.CallActivity,
  BPMN.SubProcess,
  BPMN.ExclusiveGateway,
  BPMN.InclusiveGateway,
  BPMN.ParallelGateway,
  BPMN.EventBasedGateway,
  BPMN.IntermediateThrowEvent,
  BPMN.IntermediateCatchEvent,
]);

const STUDY = 'studyflow:Study';

const listIn = (value: Value | undefined): Value[] => (Array.isArray(value) ? value : []);

const elementsIn = (value: Value | undefined): Element[] => listIn(value).filter(isElement);

export type ParsedStudy = {
  model: StudyModel;
  /** The process the run walks. */
  process: Element;
  /** The root's `studyflow:Study`: its `seed` is the run's. */
  study: Element;
  /** The steps a node module may have a screen for, and the flows between them. */
  flowNodes: Map<string, FlowNode>;
  sequenceFlows: Map<string, SequenceFlow>;
  /** What the walk walks (packages/core/src/engine), read once the link's values are bound. */
  plan: Plan;
  parameters: BoundParameters;
  /** The file's `state` tree as deposited; a session walks a copy of it. */
  state: StateTree;
};

/** The studyflow a session runs: its plan, and its steps as the node modules read them. */
export class Studyflow {
  model: StudyModel;
  process: Element;
  study: Element;
  flowNodes: Map<string, FlowNode>;
  sequenceFlows: Map<string, SequenceFlow>;
  plan: Plan;
  parameters: BoundParameters;
  state: StateTree;
  /** Identifies the exact source the run was delivered from; reported to Unity and the data-server. */
  studyflowHash?: string;

  static async parse(
    text: string,
    schemas: Record<string, any>,
    parameters: Record<string, string> = {},
  ): Promise<Studyflow> {
    return new Studyflow(await parseStudyflow(text, schemas, parameters), await sha256Hex(text));
  }

  constructor(data: ParsedStudy, studyflowHash?: string) {
    this.model = data.model;
    this.process = data.process;
    this.study = data.study;
    this.flowNodes = data.flowNodes;
    this.sequenceFlows = data.sequenceFlows;
    this.plan = data.plan;
    this.parameters = data.parameters;
    this.state = data.state;
    this.studyflowHash = studyflowHash;
  }

  /** The diagram's root, which holds the Study: the process, or a pool diagram's collaboration. */
  private get root(): Element {
    return this.model.parentOf(this.study) ?? this.study;
  }

  get studyId(): string | undefined {
    const id = this.root?.id;
    return typeof id === 'string' && id.length > 0 ? id : undefined;
  }

  get studyflowId(): string | undefined {
    const name = this.root?.name;
    return typeof name === 'string' && name.length > 0 ? name : this.studyId;
  }

  /** `seed` on the root's `studyflow:Study`, which a `seed` parameter binds to. */
  get seed(): number | undefined {
    const seed = Number(this.study?.seed);
    return Number.isFinite(seed) ? seed : undefined;
  }
}

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** A `bpmn:Property` a container declares. */
type PropertyDecl = { id: string; name: string; itemType?: string; dataState?: string; value?: unknown };

function readProperties(model: StudyModel, container: Element): PropertyDecl[] {
  const text = (value: Value | undefined): string | undefined => (typeof value === 'string' ? value : undefined);
  return elementsIn(container.properties)
    .filter((p) => model.host(p) === BPMN.Property && typeof p.id === 'string')
    .map((p) => ({
      id: p.id!,
      name: typeof p.name === 'string' && p.name.length > 0 ? p.name : p.id!,
      itemType: text(model.get(idOf(p.itemSubjectRef) ?? undefined)?.structureRef),
      dataState: isElement(p.dataState) ? text(p.dataState.name) : undefined,
      value: literal(model.attribute(p, 'value')),
    }))
    .filter((decl) => Boolean(decl.name));
}

export async function parseStudyflow(
  text: string,
  schemas: Record<string, any>,
  parameters: Record<string, string> = {},
): Promise<ParsedStudy> {
  const metamodel = metamodelOf(schemas);
  const model = looksLikeXml(text)
    ? await xmlToStudy(text, metamodel, { asWritten: true })
    : new StudyModel(readStudy(text, metamodel), metamodel);

  const process = model.study.roots.find((root) => model.host(root) === BPMN.Process);
  if (!process) {
    throw new Error('This file holds no study.');
  }
  // A plain BPMN file carries none; the run makes one, so a link's `seed` still has somewhere to go.
  const root = model.primaryRoot() ?? process;
  let study = model.studyOf(root);
  if (!study) {
    study = { type: STUDY };
    root.extensionElements = [...listIn(root.extensionElements), study];
    model.reindex();
  }

  const { wired, ...bound } = bindParameters(model, process, study, parameters);

  const flowNodes = new Map<string, FlowNode>();
  const sequenceFlows = new Map<string, SequenceFlow>();

  const gather = (container: Element): void => {
    const children = elementsIn(container.flowElements).filter((el) => typeof el.id === 'string');
    for (const el of children) {
      const type = model.host(el);
      if (type === BPMN.SequenceFlow) continue;
      if (!FLOW_NODE_TYPES.has(type) && !model.isA(el, BPMN.Task)) continue;
      flowNodes.set(el.id!, {
        id: el.id!,
        type,
        extensionType: model.extensionType(el),
        element: el,
        model,
        parameters: wired.get(el.id!) ?? {},
        outgoing: [],
        incoming: [],
      });
    }
    for (const el of children) {
      if (model.host(el) !== BPMN.SequenceFlow) continue;
      const sourceId = idOf(el.sourceRef);
      const targetId = idOf(el.targetRef);
      if (!sourceId || !targetId) continue;
      sequenceFlows.set(el.id!, { id: el.id!, sourceId, targetId, element: el });
      flowNodes.get(sourceId)?.outgoing.push(el.id!);
      flowNodes.get(targetId)?.incoming.push(el.id!);
    }
    for (const el of children) if (model.host(el) === BPMN.SubProcess) gather(el);
  };
  gather(process);

  return {
    model,
    process,
    study,
    flowNodes,
    sequenceFlows,
    plan: planOf(model),
    parameters: bound,
    state: structuredClone(model.study.state ?? {}) as StateTree,
  };
}

export type BoundParameters = {
  /** What the run starts with: the values it was launched with, and the study's seed. */
  values: Record<string, unknown>;
  /** Names the link supplied that the study already carried a value for. */
  overridden: string[];
  /** Supplied, but declared by no `studyflow:Parameters` wired into a step, `bpmn:Property`, or attribute of the study. */
  undeclared: string[];
  /** Declared names a `{name}` reference needs and nothing has bound; the study cannot run until they are given. */
  unbound: string[];
};

const NUMERIC_TYPE = /^(integer|int|long|short|byte|real|double|float|decimal|number)$/;
const BOOLEAN_TYPE = /^bool(ean)?$/;

/** URL parameters arrive as text; the declaration they bind to says what they are. */
function coerce(value: unknown, type: string | undefined): unknown {
  if (typeof value !== 'string') return value;
  const declared = (type ?? '').toLowerCase().replace(/^.*:/, '');
  if (NUMERIC_TYPE.test(declared)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (BOOLEAN_TYPE.test(declared)) return value === 'true' || value === '1';
  return value;
}

/** An overriding value takes the type of the one it replaces; the study already said what this is. */
function coerceLike(value: string, replaced: unknown): unknown {
  if (typeof replaced === 'number') return coerce(value, 'number');
  if (typeof replaced === 'boolean') return coerce(value, 'boolean');
  return value;
}

/** The `studyflow:Parameters` data objects a container declares, keyed by element id: each a copy a link may change. */
function readParameterObjects(model: StudyModel, container: Element): Map<string, Record<string, unknown>> {
  const objects = new Map<string, Record<string, unknown>>();
  for (const element of elementsIn(container.flowElements)) {
    const values = parametersIn(model, element);
    if (values && element.id) objects.set(element.id, structuredClone(values));
  }
  return objects;
}

/** Which data elements each step reads, from the associations drawn on the canvas. */
function readInputSources(container: Element): Map<string, string[]> {
  const inputs = new Map<string, string[]>();
  for (const element of elementsIn(container.flowElements)) {
    const sources = elementsIn(element.dataInputAssociations)
      .flatMap((association) => listIn(association.sourceRef).map(idOf))
      .filter((id): id is string => typeof id === 'string');
    if (sources.length > 0 && element.id) inputs.set(element.id, sources);
  }
  return inputs;
}

/** The data elements some step reads, at any depth: a Parameters object takes effect only through such a wire. */
function wiredSources(container: Element): Set<string> {
  const ids = new Set<string>();
  const visit = (node: Element): void => {
    for (const sources of readInputSources(node).values()) for (const id of sources) ids.add(id);
    for (const element of elementsIn(node.flowElements)) if (element.flowElements) visit(element);
  };
  visit(container);
  return ids;
}

/** Every name the study declares a value for, at any depth: `bpmn:Property` names, the keys of the Parameters wired
 * into a sub-process (its properties too), study attributes. */
function declaredNames(model: StudyModel, container: Element, attributes: Map<string, unknown>): Set<string> {
  const names = new Set<string>(attributes.keys());
  const objects = new Map<string, Record<string, unknown>>();
  const gather = (node: Element): void => {
    for (const [id, values] of readParameterObjects(model, node)) objects.set(id, values);
    for (const element of elementsIn(node.flowElements)) if (element.flowElements) gather(element);
  };
  gather(container);
  const visit = (node: Element): void => {
    for (const property of readProperties(model, node)) names.add(property.name);
    for (const element of elementsIn(node.flowElements)) {
      if (!element.flowElements) continue;
      for (const association of elementsIn(element.dataInputAssociations)) {
        for (const source of listIn(association.sourceRef)) for (const name of Object.keys(objects.get(idOf(source) ?? '') ?? {})) names.add(name);
      }
      visit(element);
    }
  };
  visit(container);
  return names;
}

/** The values a container's properties declare, by name. */
function declaredValues(model: StudyModel, container: Element): Record<string, unknown> {
  return Object.fromEntries(readProperties(model, container).filter((p) => p.value !== undefined).map((p) => [p.name, p.value]));
}

/** Binds what a run was launched with to what the study declares, then substitutes `{name}` wherever it is written. */
function bindParameters(
  model: StudyModel,
  process: Element,
  study: Element,
  given: Record<string, string>,
): BoundParameters & { wired: Map<string, Record<string, unknown>> } {
  const wired = wiredSources(process);
  const objects = readParameterObjects(model, process);
  const properties = new Map(readProperties(model, process).map((p) => [p.name, p.itemType]));
  // The Study's one attribute a run is launched with; its others (`runtime`, `version`) are about the study, not run values.
  const attributes = new Map<string, string | undefined>([['seed', model.metamodel.property(STUDY, 'seed')?.type]]);

  const values: Record<string, unknown> = {};
  const ambient: Record<string, unknown> = {};
  const overridden: string[] = [];
  const undeclared: string[] = [];

  for (const [name, raw] of Object.entries(given)) {
    // A dotted name reaches inside a Parameters object (`Bot.Speed`); a link replaces one value, never a whole mapping or list.
    const path = name.split('.');
    const carriers = [...objects].filter(([id, carried]) => wired.has(id) && hasPath(carried, path));
    if (carriers.length > 0) {
      for (const [id, carried] of carriers) {
        const holder = path.slice(0, -1).reduce((node: any, key) => node[key], carried);
        const leaf = path[path.length - 1];
        const replaced = holder[leaf];
        if (replaced !== null && typeof replaced === 'object') {
          throw new Error(`The link sets '${name}', a whole ${Array.isArray(replaced) ? 'list' : 'mapping'} in ${id}: `
            + `set one value inside it instead, as ${name}.<key>.`);
        }
        holder[leaf] = coerceLike(raw, replaced);
      }
      overridden.push(name);
      // A name the study also declares binds there too: `{name}` reads properties, never Parameters.
      if (!properties.has(name) && !attributes.has(name)) continue;
    }
    const bound = properties.has(name) ? coerce(raw, properties.get(name))
      : attributes.has(name) ? coerce(raw, attributes.get(name))
      : raw;
    if (!properties.has(name) && !attributes.has(name)) undeclared.push(name);
    values[name] = bound;
    ambient[name] = bound;
  }

  // An attribute of the study is one more place a value lives: the run's wins, the pinned one stands in.
  for (const [name, type] of attributes) {
    if (name in values) {
      if (study[name] !== undefined) overridden.push(name);
      study[name] = coerce(values[name], type) as Value;
    } else if (study[name] !== undefined) {
      values[name] = study[name];
      ambient[name] = study[name];
    }
  }

  // A `{name}` the study declares nowhere is someone else's placeholder (the end event's `{COMPLETION_CODE}`,
  // a run-state `{count}`) and stays as written; a declared one left without a value blocks the run.
  const declared = declaredNames(model, process, attributes);
  const unbound = new Set<string>();
  const substitute = (text: string, scope: Record<string, unknown>): string => text.replace(PLACEHOLDER, (ref, name: string) => {
    const bound = scope[name];
    if (bound !== undefined && bound !== '') return String(bound);
    if (declared.has(name)) unbound.add(name);
    return ref;
  });

  /** Every text a YAML-typed value holds, however deep, as its text was. */
  const substituteValue = (value: Value, scope: Record<string, unknown>): Value => {
    if (typeof value === 'string') return substitute(value, scope);
    if (Array.isArray(value)) return value.map((item) => substituteValue(item, scope));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteValue(item as Value, scope)]));
    return value;
  };

  /** An element's texts, and those of what it holds but its flow elements; a reference belongs to the element it names. */
  const substituteIn = (element: Element, scope: Record<string, unknown>, seen: Set<Element>): void => {
    if (seen.has(element)) return;
    seen.add(element);
    for (const [key, value] of Object.entries(element)) {
      if (key === 'type' || key === 'flowElements' || value === undefined || model.propertyAt(element, key)?.isReference) continue;
      if (typeof value === 'string') element[key] = substitute(value, scope);
      else if (isElement(value)) substituteIn(value, scope, seen);
      else if (Array.isArray(value)) for (const item of value) { if (isElement(item)) substituteIn(item, scope, seen); }
      else if (value && typeof value === 'object') element[key] = substituteValue(value, scope);
    }
  };

  /** A container's properties fill `{name}` for everything inside it, an inner one hiding an outer. A step reads the
   * Parameters wired into it, from its own container or one around it; a data object wired nowhere does nothing. */
  const reads = new Map<string, Record<string, unknown>>();
  const bindContainer = (container: Element, inherited: Record<string, unknown>, outer: Map<string, Record<string, unknown>>): void => {
    const carried = container === process ? objects : readParameterObjects(model, container);
    const reachable = new Map([...outer, ...carried]);
    const inputs = readInputSources(container);
    const scope = container === process ? inherited : { ...inherited, ...declaredValues(model, container) };

    substituteIn(container, scope, new Set());
    for (const element of elementsIn(container.flowElements)) {
      const sources = [...new Set(inputs.get(element.id ?? ''))]
        .flatMap((id): [string, Record<string, unknown>][] => (reachable.has(id) ? [[id, reachable.get(id)!]] : []));
      // A key naming one of the step's attributes sets it (`instrument: WO`); the rest is a task's settings, a sub-process's
      // read-only properties.
      let rest: Record<string, unknown> = {};
      if (sources.length > 0 && element.id) {
        const split = splitIn(model, element, mergeParameters(element.id, sources));
        for (const [name, value] of Object.entries(split.attributes)) model.setAttribute(element, name, value as Value);
        rest = split.rest;
        reads.set(element.id, rest);
      }
      if (element.flowElements) bindContainer(element, { ...scope, ...rest }, reachable);
      else substituteIn(element, scope, new Set());
    }
  };

  // The study's own properties, a link's values over their declared ones.
  const rootScope = { ...declaredValues(model, process), ...ambient };
  bindContainer(process, rootScope, new Map());

  const seen = new Set<Element>([process]);
  for (const root of model.study.roots) substituteIn(root, rootScope, seen);

  return { values, overridden: [...new Set(overridden)], undeclared, unbound: [...unbound], wired: reads };
}
