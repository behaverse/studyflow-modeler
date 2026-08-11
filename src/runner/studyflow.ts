import { BpmnModdle } from 'bpmn-moddle';
import { choreographyToProcessRoot, looksLikeXml, studyflowToDefinitions } from '@/core/document';
import { getExtensionType } from '@/core/element';
import { BPMN, isDeclaredProperty } from '@/core/constants';
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

export type BoundParameters = {
  /** Every value the run was launched with, typed by the declaration it bound to. */
  values: Record<string, unknown>;
  /** Given, but declared by neither a `bpmn:Property` nor an attribute of the study. */
  undeclared: string[];
  /** `${name}` references the run was launched without a value for; the study cannot run until they are given. */
  unbound: string[];
};

const NUMERIC_TYPE = /^(integer|int|long|short|byte|real|double|float|decimal|number)$/;
const BOOLEAN_TYPE = /^bool(ean)?$/;

/** URL parameters arrive as text; the declaration they bind to says what they are. */
function coerce(value: string, type: string | undefined): unknown {
  const declared = (type ?? '').toLowerCase().replace(/^.*:/, '');
  if (NUMERIC_TYPE.test(declared)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (BOOLEAN_TYPE.test(declared)) return value === 'true' || value === '1';
  return value;
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
  const properties = new Map(readProperties(businessObject).map((p) => [p.name, p.itemType]));
  const attributes = declaredAttributes(businessObject);

  const values: Record<string, unknown> = {};
  const undeclared: string[] = [];
  for (const [name, raw] of Object.entries(given)) {
    if (properties.has(name)) {
      values[name] = coerce(raw, properties.get(name));
    } else if (attributes.has(name)) {
      values[name] = coerce(raw, attributes.get(name));
      businessObject.set(name, values[name]);
    } else {
      values[name] = raw;
      undeclared.push(name);
    }
  }

  const unbound = new Set<string>();
  const seen = new Set<object>();

  const substitute = (text: string): string =>
    text.replace(PARAMETER_REF, (ref, name: string) => {
      const value = values[name];
      if (value === undefined || value === '') {
        unbound.add(name);
        return ref;
      }
      return String(value);
    });

  const walk = (node: any): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const key of Object.keys(node)) {
      // `$parent`, `$descriptor` and friends are moddle's own wiring, not authored content.
      if (key.startsWith('$')) continue;
      const value = node[key];
      if (typeof value === 'string') node[key] = substitute(value);
      else walk(value);
    }
    for (const [key, value] of Object.entries(node.$attrs ?? {})) {
      if (typeof value === 'string') node.$attrs[key] = substitute(value);
    }
  };

  walk(definitions);
  return { values, undeclared, unbound: [...unbound] };
}
