import { BpmnModdle } from 'bpmn-moddle';
import * as yaml from 'js-yaml';
import {
  PLACEHOLDER,
  choreographyToProcessRoot,
  ensureStudyExtension,
  looksLikeXml,
  readState,
  studyflowToDefinitions,
  type StateTree,
} from '@core/document';
import { getAttribute, getExtensionType, getRawAttribute } from '@core/element';
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
    const scope: Scope = {
      id: scopeId,
      parentId,
      startId: undefined,
      properties: readProperties(container),
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

const PARAMETERS_TYPE = 'studyflow:Parameters';

export type BoundParameters = {
  /** What the run holds: the study's own values, with the ones it was launched with layered over them. */
  values: Record<string, unknown>;
  /** Names the link supplied that the study already carried a value for. */
  overridden: string[];
  /** Supplied, but declared by no `studyflow:Parameters`, `bpmn:Property`, or attribute of the study. */
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

/** Whether `path` (`Bot.Speed`, `Streams.0`) leads to a value inside `node`. */
function hasPath(node: unknown, path: string[]): boolean {
  for (const key of path) {
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, key)) return false;
    node = (node as Record<string, unknown>)[key];
  }
  return true;
}

const isMapping = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** What a step reads: the `studyflow:Parameters` wired into it, merged. Mappings merge key by key; a value two of
 * them set is an error, since nothing drawn orders the wires. `skills/local/run.py` merges the same way. */
function mergeWired(stepId: string, sources: [string, Record<string, unknown>][]): Record<string, unknown> {
  const into = (target: Record<string, unknown>, source: Record<string, unknown>, id: string, path: string[]): void => {
    for (const [key, value] of Object.entries(source)) {
      const at = [...path, key];
      if (!Object.hasOwn(target, key)) {
        target[key] = structuredClone(value);
      } else if (isMapping(target[key]) && isMapping(value)) {
        into(target[key], value, id, at);
      } else {
        const [other] = sources.find(([, carried]) => hasPath(carried, at))!;
        throw new Error(`${stepId} reads ${at.join('.')} from both ${other} and ${id}: set it in one of them.`);
      }
    }
  };
  const merged: Record<string, unknown> = {};
  for (const [id, carried] of sources) into(merged, carried, id, []);
  return merged;
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

/** Every name the study declares a value for, at any depth: `studyflow:Parameters` keys, `bpmn:Property` names, study attributes. */
function declaredNames(container: any, attributes: Map<string, unknown>): Set<string> {
  const names = new Set<string>(attributes.keys());
  const visit = (node: any): void => {
    for (const values of readParameterObjects(node).values()) for (const name of Object.keys(values)) names.add(name);
    for (const property of readProperties(node)) names.add(property.name);
    for (const element of node?.flowElements ?? []) if (element.flowElements) visit(element);
  };
  visit(container);
  return names;
}

/** Binds what a run was launched with to what the study declares, then substitutes `{name}` wherever it is written. */
function bindParameters(
  definitions: any,
  businessObject: any,
  study: any,
  given: Record<string, string>,
): BoundParameters & { wired: Map<string, Record<string, unknown>> } {
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
    const carriers = [...objects].filter(([, carried]) => hasPath(carried, path));
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
      continue;
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

  /** What a step reads takes `{name}` in its keys and strings too; a string that is one placeholder takes the value itself, type and all. */
  const substituteValues = (value: unknown, scope: Record<string, unknown>): unknown => {
    if (typeof value === 'string') {
      const [only] = [...value.matchAll(PLACEHOLDER)];
      const bound = only?.[0] === value ? scope[only[1]] : undefined;
      return bound !== undefined && bound !== '' ? bound : substitute(value, scope);
    }
    if (Array.isArray(value)) return value.map((item) => substituteValues(item, scope));
    if (!isMapping(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [substitute(key, scope), substituteValues(item, scope)]));
  };

  /** A step reads what is wired into it, from its own container or one around it; a data object wired nowhere is the study's own configuration. */
  const reads = new Map<string, Record<string, unknown>>();
  const bindContainer = (container: any, inherited: Record<string, unknown>, outer: Map<string, Record<string, unknown>>): void => {
    const carried = container === businessObject ? objects : readParameterObjects(container);
    const reachable = new Map([...outer, ...carried]);
    const inputs = readInputSources(container);
    const wired = new Set([...inputs.values()].flat());

    const scope = { ...inherited };
    for (const [id, carriedValues] of carried) {
      Object.assign(values, carriedValues);
      if (!wired.has(id)) Object.assign(scope, carriedValues);
    }

    const seen = new Set<object>();
    substituteIn(container, scope, seen);
    for (const element of container.flowElements ?? []) {
      const sources = [...new Set(inputs.get(element.id))]
        .flatMap((id): [string, Record<string, unknown>][] => (
          reachable.has(id) ? [[id, substituteValues(reachable.get(id), scope) as Record<string, unknown>]] : []));
      const read = mergeWired(element.id, sources);
      if (sources.length > 0) reads.set(element.id, read);
      const elementScope = { ...scope, ...read };
      substituteIn(element, elementScope, new Set());
      if (element.flowElements) bindContainer(element, elementScope, reachable);
    }
  };

  bindContainer(businessObject, ambient, new Map());
  substituteIn(definitions, ambient, new Set([businessObject]));

  return { values, overridden: [...new Set(overridden)], undeclared, unbound: [...unbound], wired: reads };
}
