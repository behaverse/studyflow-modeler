import { BpmnModdle } from 'bpmn-moddle';
import * as yaml from 'js-yaml';
import {
  PARAMETERS_TYPE,
  PLACEHOLDER,
  choreographyToProcessRoot,
  ensureStudyExtension,
  looksLikeXml,
  hasPath,
  mergeParameters,
  readState,
  splitAttributes,
  studyflowToDefinitions,
  type StateTree,
} from '@core/document';
import { getAttribute, getExtensionType, getRawAttribute, setAttribute } from '@core/element';
import { BPMN, isDeclaredProperty } from '@core/constants';
import type { FlowNode, SequenceFlow } from '@runner/flow';
import type { PropertyDecl, Scope } from '@runner/scope';

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

export type ParsedStudy = {
  businessObject: any;
  /** The root's `studyflow:Study`: its `seed` is the run's. */
  study: any;
  flowNodes: Map<string, FlowNode>;
  sequenceFlows: Map<string, SequenceFlow>;
  startId?: string;
  scopes: Map<string, Scope>;
  rootScopeId: string;
  parameters: BoundParameters;
  /** The file's `state` tree as deposited; a session copies it and mirrors its own writes into the copy. */
  state: StateTree;
};

/** The studyflow a run traverses: its flow nodes, sequence flows, and scopes. */
export class Studyflow {
  businessObject: any;
  study: any;
  flowNodes: Map<string, FlowNode>;
  sequenceFlows: Map<string, SequenceFlow>;
  startId?: string;
  scopes: Map<string, Scope>;
  rootScopeId: string;
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
    this.businessObject = data.businessObject;
    this.study = data.study;
    this.flowNodes = data.flowNodes;
    this.sequenceFlows = data.sequenceFlows;
    this.startId = data.startId;
    this.scopes = data.scopes;
    this.rootScopeId = data.rootScopeId;
    this.parameters = data.parameters;
    this.state = data.state;
    this.studyflowHash = studyflowHash;
  }

  /** The diagram's root, whose `extensionElements` hold the Study: the process, or a pool diagram's collaboration. */
  private get root(): any {
    return this.study?.$parent?.$parent ?? this.businessObject;
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

function readProperties(container: any): PropertyDecl[] {
  const properties = container?.properties ?? container?.get?.('properties') ?? [];
  return (Array.isArray(properties) ? properties : [])
    .filter((p: any) => isDeclaredProperty(p))
    .map((p: any) => ({
      id: p.id,
      name: typeof p.name === 'string' && p.name.length > 0 ? p.name : p.id,
      itemType: p.itemSubjectRef?.structureRef,
      dataState: p.dataState?.name,
      value: parseLiteral(p.value ?? getRawAttribute(p, 'value')),
    }))
    .filter((decl: PropertyDecl) => Boolean(decl.name));
}

/** `studyflow:value` is JSON when it parses (`0`, `true`, `"x"`), otherwise the text itself. */
function parseLiteral(text: unknown): unknown {
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function parseStudyflow(
  text: string,
  schemas: Record<string, any>,
  parameters: Record<string, string> = {},
): Promise<ParsedStudy> {
  const moddle = new BpmnModdle(schemas);
  const definitions = looksLikeXml(text)
    ? (await moddle.fromXML(text)).rootElement
    : studyflowToDefinitions(text, moddle);

  choreographyToProcessRoot(definitions);

  const businessObject = (definitions as any)?.rootElements?.find((re: any) => re?.$type === 'bpmn:Process');
  if (!businessObject) {
    throw new Error('This file holds no study.');
  }
  // A plain BPMN file carries none; the run makes one, so a link's `seed` still has somewhere to go.
  const study = ensureStudyExtension(definitions, moddle);

  const { wired, ...bound } = bindParameters(definitions, businessObject, study, parameters);

  const flowNodes = new Map<string, FlowNode>();
  const sequenceFlows = new Map<string, SequenceFlow>();
  const scopes = new Map<string, Scope>();
  const rootScopeId = businessObject.id ?? 'process';

  const walkContainer = (container: any, scopeId: string, parentId?: string): void => {
    // The Parameters wired into a sub-process are read-only properties of it, beside the ones it declares.
    const declared = readProperties(container);
    const fromParameters = Object.entries(wired.get(scopeId) ?? {}).map(([name, value]): PropertyDecl => {
      if (declared.some((p) => p.name === name)) {
        throw new Error(`${scopeId} declares '${name}' as a property and in the Parameters wired into it: keep one.`);
      }
      return { id: `${scopeId}.${name}`, name, value, readOnly: true };
    });
    const scope: Scope = {
      id: scopeId,
      parentId,
      startId: undefined,
      properties: [...declared, ...fromParameters],
    };
    scopes.set(scopeId, scope);

    const children: any[] = container?.flowElements ?? [];

    for (const el of children) {
      if (el.$type === 'bpmn:SequenceFlow') continue;
      if (!FLOW_NODE_TYPES.has(el.$type) && !el.$instanceOf?.(BPMN.Task)) continue;

      flowNodes.set(el.id, {
        id: el.id,
        type: el.$type,
        extensionType: getExtensionType(el),
        businessObject: el,
        parameters: wired.get(el.id) ?? {},
        outgoing: [],
        incoming: [],
        scopeId,
      });

      if (el.$type === 'bpmn:StartEvent' && !scope.startId) scope.startId = el.id;
    }

    for (const el of children) {
      if (el.$type !== 'bpmn:SequenceFlow') continue;

      const sourceId = el.sourceRef?.id;
      const targetId = el.targetRef?.id;
      if (!sourceId || !targetId) continue;

      const rawCondition = el.get?.('conditionExpression') ?? el.conditionExpression;
      const condition = typeof rawCondition === 'string'
        ? rawCondition
        : rawCondition?.body ?? rawCondition?.get?.('body');
      const conditionLanguage = typeof rawCondition === 'string'
        ? undefined
        : rawCondition?.language ?? rawCondition?.get?.('language');

      sequenceFlows.set(el.id, {
        id: el.id,
        sourceId,
        targetId,
        conditionExpression: typeof condition === 'string' ? condition : undefined,
        conditionLanguage: typeof conditionLanguage === 'string' ? conditionLanguage : undefined,
        businessObject: el,
      });

      flowNodes.get(sourceId)?.outgoing.push(el.id);
      flowNodes.get(targetId)?.incoming.push(el.id);
    }

    for (const el of children) {
      if (el.$type === 'bpmn:SubProcess') walkContainer(el, el.id, scopeId);
    }
  };

  walkContainer(businessObject, rootScopeId);

  const rootScope = scopes.get(rootScopeId)!;
  if (!rootScope.startId) {
    // A process may leave out its start event (BPMN 2.0 §10.2); it then starts wherever nothing flows into.
    const entries = [...flowNodes.values()]
      .filter((node) => node.scopeId === rootScopeId && node.incoming.length === 0);
    if (entries.length === 1) rootScope.startId = entries[0].id;
  }

  return {
    businessObject,
    study,
    flowNodes,
    sequenceFlows,
    startId: scopes.get(rootScopeId)?.startId,
    scopes,
    rootScopeId,
    parameters: bound,
    state: readState(definitions),
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

/** The `studyflow:Parameters` data objects a container declares, keyed by element id. */
function readParameterObjects(container: any): Map<string, Record<string, unknown>> {
  const objects = new Map<string, Record<string, unknown>>();
  for (const element of container?.flowElements ?? []) {
    if (getExtensionType(element) !== PARAMETERS_TYPE) continue;
    const text = getAttribute(element, 'values');
    if (typeof text !== 'string' || !text.trim()) continue;
    const parsed = yaml.load(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      objects.set(element.id, { ...(parsed as Record<string, unknown>) });
    }
  }
  return objects;
}

/** Which data elements each step reads, from the associations drawn on the canvas. */
function readInputSources(container: any): Map<string, string[]> {
  const inputs = new Map<string, string[]>();
  for (const element of container?.flowElements ?? []) {
    const sources = (element.dataInputAssociations ?? [])
      .flatMap((association: any) => association.sourceRef ?? [])
      .map((source: any) => source?.id)
      .filter((id: unknown): id is string => typeof id === 'string');
    if (sources.length > 0) inputs.set(element.id, sources);
  }
  return inputs;
}

/** The data elements some step reads, at any depth: a Parameters object takes effect only through such a wire. */
function wiredSources(container: any): Set<string> {
  const ids = new Set<string>();
  const visit = (node: any): void => {
    for (const sources of readInputSources(node).values()) for (const id of sources) ids.add(id);
    for (const element of node?.flowElements ?? []) if (element.flowElements) visit(element);
  };
  visit(container);
  return ids;
}

/** Every name the study declares a value for, at any depth: `bpmn:Property` names, the keys of the Parameters wired
 * into a sub-process (its properties too), study attributes. */
function declaredNames(container: any, attributes: Map<string, unknown>): Set<string> {
  const names = new Set<string>(attributes.keys());
  const objects = new Map<string, Record<string, unknown>>();
  const gather = (node: any): void => {
    for (const [id, values] of readParameterObjects(node)) objects.set(id, values);
    for (const element of node?.flowElements ?? []) if (element.flowElements) gather(element);
  };
  gather(container);
  const visit = (node: any): void => {
    for (const property of readProperties(node)) names.add(property.name);
    for (const element of node?.flowElements ?? []) {
      if (!element.flowElements) continue;
      for (const association of element.dataInputAssociations ?? []) {
        for (const source of association.sourceRef ?? []) for (const name of Object.keys(objects.get(source?.id) ?? {})) names.add(name);
      }
      visit(element);
    }
  };
  visit(container);
  return names;
}

/** The values a container's properties declare, by name. */
function declaredValues(container: any): Record<string, unknown> {
  return Object.fromEntries(readProperties(container).filter((p) => p.value !== undefined).map((p) => [p.name, p.value]));
}

/** Binds what a run was launched with to what the study declares, then substitutes `{name}` wherever it is written. */
function bindParameters(
  definitions: any,
  businessObject: any,
  study: any,
  given: Record<string, string>,
): BoundParameters & { wired: Map<string, Record<string, unknown>> } {
  const wired = wiredSources(businessObject);
  const objects = readParameterObjects(businessObject);
  const properties = new Map(readProperties(businessObject).map((p) => [p.name, p.itemType]));
  // The Study's one attribute a run is launched with; its others (`runtime`, `version`) are about the study, not run values.
  const attributes = new Map<string, string | undefined>([['seed', study.$descriptor.propertiesByName.seed?.type]]);

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
      study.set(name, coerce(values[name], type));
    } else if (study[name] !== undefined) {
      values[name] = study[name];
      ambient[name] = study[name];
    }
  }

  // A `{name}` the study declares nowhere is someone else's placeholder (the end event's `{COMPLETION_CODE}`,
  // a run-state `{count}`) and stays as written; a declared one left without a value blocks the run.
  const declared = declaredNames(businessObject, attributes);
  const unbound = new Set<string>();
  const substitute = (text: string, scope: Record<string, unknown>): string => text.replace(PLACEHOLDER, (ref, name: string) => {
    const bound = scope[name];
    if (bound !== undefined && bound !== '') return String(bound);
    if (declared.has(name)) unbound.add(name);
    return ref;
  });

  const substituteIn = (node: any, scope: Record<string, unknown>, seen: Set<object>): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) substituteIn(item, scope, seen);
      return;
    }
    const byName = node.$descriptor?.propertiesByName ?? {};
    for (const key of Object.keys(node)) {
      // `$parent` and friends are moddle's wiring; a reference belongs to the element it points at, not this one.
      if (key.startsWith('$') || key === 'flowElements' || byName[key]?.isReference) continue;
      const value = node[key];
      if (typeof value === 'string') {
        node[key] = substitute(value, scope);
      } else {
        substituteIn(value, scope, seen);
      }
    }
    for (const [key, value] of Object.entries(node.$attrs ?? {})) {
      if (typeof value !== 'string') continue;
      node.$attrs[key] = substitute(value, scope);
    }
  };

  /** A container's properties fill `{name}` for everything inside it, an inner one hiding an outer. A step reads the
   * Parameters wired into it, from its own container or one around it; a data object wired nowhere does nothing. */
  const reads = new Map<string, Record<string, unknown>>();
  const bindContainer = (container: any, inherited: Record<string, unknown>, outer: Map<string, Record<string, unknown>>): void => {
    const carried = container === businessObject ? objects : readParameterObjects(container);
    const reachable = new Map([...outer, ...carried]);
    const inputs = readInputSources(container);
    const scope = container === businessObject ? inherited : { ...inherited, ...declaredValues(container) };

    const seen = new Set<object>();
    substituteIn(container, scope, seen);
    for (const element of container.flowElements ?? []) {
      const sources = [...new Set(inputs.get(element.id))]
        .flatMap((id): [string, Record<string, unknown>][] => (reachable.has(id) ? [[id, reachable.get(id)!]] : []));
      // A key naming one of the step's attributes sets it (`instrument: WO`); the rest is a task's settings, a sub-process's
      // read-only properties.
      let rest: Record<string, unknown> = {};
      if (sources.length > 0) {
        const split = splitAttributes(element, mergeParameters(element.id, sources), element.id);
        for (const [name, value] of Object.entries(split.attributes)) setAttribute(element, name, value);
        rest = split.rest;
        reads.set(element.id, rest);
      }
      if (element.flowElements) bindContainer(element, { ...scope, ...rest }, reachable);
      else substituteIn(element, scope, new Set());
    }
  };

  // The study's own properties, a link's values over their declared ones.
  const rootScope = { ...declaredValues(businessObject), ...ambient };
  bindContainer(businessObject, rootScope, new Map());

  substituteIn(definitions, rootScope, new Set([businessObject]));

  return { values, overridden: [...new Set(overridden)], undeclared, unbound: [...unbound], wired: reads };
}
