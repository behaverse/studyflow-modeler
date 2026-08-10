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
};

/** The studyflow a run traverses: its flow nodes, sequence flows, and scopes. */
export class Studyflow {
  businessObject: any;
  flowNodes: Map<string, FlowNode>;
  sequenceFlows: Map<string, SequenceFlow>;
  startId?: string;
  scopes: Map<string, Scope>;
  rootScopeId: string;
  /** Identifies the exact source the run was delivered from; reported to Unity and the data-server. */
  studyflowHash?: string;

  static async parse(text: string, schemas: Record<string, any>): Promise<Studyflow> {
    return new Studyflow(await parseStudyflow(text, schemas), await sha256Hex(text));
  }

  constructor(data: ParsedStudy, studyflowHash?: string) {
    this.businessObject = data.businessObject;
    this.flowNodes = data.flowNodes;
    this.sequenceFlows = data.sequenceFlows;
    this.startId = data.startId;
    this.scopes = data.scopes;
    this.rootScopeId = data.rootScopeId;
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

export async function parseStudyflow(text: string, schemas: Record<string, any>): Promise<ParsedStudy> {
  const moddle = new BpmnModdle(schemas);
  const definitions = looksLikeXml(text)
    ? (await moddle.fromXML(text)).rootElement
    : studyflowToDefinitions(text, moddle);

  choreographyToProcessRoot(definitions);

  const businessObject = (definitions as any)?.rootElements?.find(
    (re: any) => re?.$type === 'bpmn:Process' || re?.$type === 'studyflow:Study',
  );
  if (!businessObject) throw new Error('No bpmn:Process found in diagram.');

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

  return {
    businessObject,
    flowNodes,
    sequenceFlows,
    startId: scopes.get(rootScopeId)?.startId,
    scopes,
    rootScopeId,
  };
}
