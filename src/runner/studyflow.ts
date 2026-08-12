import { BpmnModdle } from 'bpmn-moddle';
import * as yaml from 'js-yaml';
import { choreographyToProcessRoot, looksLikeXml, studyflowToDefinitions } from '@behaverse/studyflow-core/document';
import { getAttribute, getExtensionType } from '@behaverse/studyflow-core/element';
import { BPMN, isDeclaredProperty } from '@behaverse/studyflow-core/constants';
import type { FlowNode, SequenceFlow } from '@/runner/flow';
import type { PropertyDecl, Scope } from '@/runner/scope';

/** The `bpmn:FlowNode` subtypes a run can reach; anything else in the process is ignored. */
const FLOW_NODE_TYPES: ReadonlySet<string> = new Set<string>([
  BPMN.StartEvent,
  BPMN.EndEvent,
  BPMN.Task,
  BPMN.UserTask,
  BPMN.ServiceTask,
  BPMN.ScriptTask,
  BPMN.ManualTask,
  BPMN.ChoreographyTask,
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
  flowNodes: Map<string, FlowNode>;
  sequenceFlows: Map<string, SequenceFlow>;
  startId?: string;
  scopes: Map<string, Scope>;
  rootScopeId: string;
  parameters: BoundParameters;
};

/** The studyflow a run traverses: its flow nodes, sequence flows, and scopes. */
export class Studyflow {
  businessObject: any;
  flowNodes: Map<string, FlowNode>;
  sequenceFlows: Map<string, SequenceFlow>;
  startId?: string;
  scopes: Map<string, Scope>;
  rootScopeId: string;
  parameters: BoundParameters;
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
    this.flowNodes = data.flowNodes;
    this.sequenceFlows = data.sequenceFlows;
    this.startId = data.startId;
    this.scopes = data.scopes;
    this.rootScopeId = data.rootScopeId;
    this.parameters = data.parameters;
    this.studyflowHash = studyflowHash;
  }

  get studyId(): string | undefined {
    const id = this.businessObject?.id;
    return typeof id === 'string' && id.length > 0 ? id : undefined;
  }

  get studyflowId(): string | undefined {
    const name = this.businessObject?.name;
    return typeof name === 'string' && name.length > 0 ? name : this.studyId;
  }

  /** `studyflow:seed` on the study, which a `seed` parameter binds to like any other declared attribute. */
  get seed(): number | undefined {
    const seed = Number(this.businessObject?.seed);
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
    }))
    .filter((decl: PropertyDecl) => Boolean(decl.name));
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

  const businessObject = (definitions as any)?.rootElements?.find(
    (re: any) => re?.$type === 'bpmn:Process' || re?.$type === 'studyflow:Study',
  );
  if (!businessObject) throw new Error('No bpmn:Process found in diagram.');

  const bound = bindParameters(definitions, businessObject, parameters);

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
      if (!FLOW_NODE_TYPES.has(el.$type)) continue;

      flowNodes.set(el.id, {
        id: el.id,
        type: el.$type,
        extensionType: getExtensionType(el),
        businessObject: el,
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
    flowNodes,
    sequenceFlows,
    startId: scopes.get(rootScopeId)?.startId,
    scopes,
    rootScopeId,
    parameters: bound,
  };
}

const PARAMETER_REF = /\$\{\s*([^}\s]+)\s*\}/g;
const PARAMETERS_TYPE = 'studyflow:Parameters';

export type BoundParameters = {
  /** What the run holds: the study's own values, with the ones it was launched with layered over them. */
  values: Record<string, unknown>;
  /** Names the link supplied that the study already carried a value for. */
  overridden: string[];
  /** Supplied, but declared by no `studyflow:Parameters`, `bpmn:Property`, or attribute of the study. */
  undeclared: string[];
  /** `${name}` references nothing has bound; the study cannot run until they are given. */
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

/** An overriding value takes the type of the one it replaces — the study already said what this is. */
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

/** Attributes a parameter may set on the study: those an extension schema declares, e.g. `studyflow:seed`. */
function declaredAttributes(businessObject: any): Map<string, string | undefined> {
  const byName = businessObject?.$descriptor?.propertiesByName ?? {};
  const attributes = new Map<string, string | undefined>();
  for (const [name, property] of Object.entries<any>(byName)) {
    if (!property?.isAttr || property.ns?.prefix === 'bpmn' || name.includes(':')) continue;
    attributes.set(name, property.type);
  }
  return attributes;
}

/** Binds what a run was launched with to what the study declares, then substitutes `${name}` wherever it is written. */
function bindParameters(
  definitions: any,
  businessObject: any,
  given: Record<string, string>,
): BoundParameters {
  const objects = readParameterObjects(businessObject);
  const properties = new Map(readProperties(businessObject).map((p) => [p.name, p.itemType]));
  const attributes = declaredAttributes(businessObject);

  const values: Record<string, unknown> = {};
  const ambient: Record<string, unknown> = {};
  const overridden: string[] = [];
  const undeclared: string[] = [];

  for (const [name, raw] of Object.entries(given)) {
    const carriers = [...objects.values()].filter((carried) => name in carried);
    if (carriers.length > 0) {
      for (const carried of carriers) carried[name] = coerceLike(raw, carried[name]);
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
      if (businessObject[name] !== undefined) overridden.push(name);
      businessObject.set(name, coerce(values[name], type));
    } else if (businessObject[name] !== undefined) {
      values[name] = businessObject[name];
      ambient[name] = businessObject[name];
    }
  }

  const unbound = new Set<string>();

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
        node[key] = value.replace(PARAMETER_REF, (ref, name: string) => {
          const bound = scope[name];
          if (bound === undefined || bound === '') {
            unbound.add(name);
            return ref;
          }
          return String(bound);
        });
      } else {
        substituteIn(value, scope, seen);
      }
    }
    for (const [key, value] of Object.entries(node.$attrs ?? {})) {
      if (typeof value !== 'string') continue;
      node.$attrs[key] = value.replace(PARAMETER_REF, (ref, name: string) => {
        const bound = scope[name];
        if (bound === undefined || bound === '') {
          unbound.add(name);
          return ref;
        }
        return String(bound);
      });
    }
  };

  /** A step reads what is wired into it; a data object wired nowhere is the study's own configuration. */
  const bindContainer = (container: any, inherited: Record<string, unknown>): void => {
    const carried = container === businessObject ? objects : readParameterObjects(container);
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
      const read = Object.assign({}, ...(inputs.get(element.id) ?? []).map((id) => carried.get(id) ?? {}));
      const elementScope = { ...scope, ...read };
      substituteIn(element, elementScope, new Set());
      if (element.flowElements) bindContainer(element, elementScope);
    }
  };

  bindContainer(businessObject, ambient);
  substituteIn(definitions, ambient, new Set([businessObject]));

  return { values, overridden: [...new Set(overridden)], undeclared, unbound: [...unbound] };
}
