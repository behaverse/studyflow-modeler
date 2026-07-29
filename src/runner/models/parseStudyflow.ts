import { BpmnModdle } from 'bpmn-moddle';
import { looksLikeXml, normalizeStudyflowXml, studyflowToDefinitions } from '@/core/codec';
import { choreographyToProcessRoot } from '@/core/codec/choreography';
import { getExtensionType } from '@/core/extensions';
import type { FlowNode, PropertyDecl, Scope, SequenceFlow } from '@/runner/models/flow';

const FLOW_NODE_TYPES = new Set([
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:ManualTask',
  'bpmn:ChoreographyTask',
  'bpmn:SubProcess',
  'bpmn:ExclusiveGateway',
  'bpmn:InclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:EventBasedGateway',
  'bpmn:IntermediateThrowEvent',
  'bpmn:IntermediateCatchEvent',
]);

export type ParsedStudy = {
  businessObject: any;
  flowNodes: Map<string, FlowNode>;
  sequenceFlows: Map<string, SequenceFlow>;
  startId?: string;
  /** One entry per container, keyed by owner id; see `flow.ts`. */
  scopes: Map<string, Scope>;
  /** Id of the process scope. */
  rootScopeId: string;
};

/**
 * `bpmn:Property` declarations on a container. BPMN gives every process,
 * activity, and event this container; the runner reads it as the scope's
 * declared variables (§10.3.1).
 */
function readProperties(container: any): PropertyDecl[] {
  const properties = container?.properties ?? container?.get?.('properties') ?? [];
  return (Array.isArray(properties) ? properties : [])
    .filter((p: any) => p?.$type === 'bpmn:Property')
    .map((p: any) => ({
      id: p.id,
      name: typeof p.name === 'string' && p.name.length > 0 ? p.name : p.id,
      itemType: p.itemSubjectRef?.structureRef,
      dataState: p.dataState?.name,
    }))
    .filter((decl: PropertyDecl) => Boolean(decl.name));
}

/** Accepts both `.studyflow` serializations: BPMN 2.0 XML and YAML. */
export async function parseStudyflow(text: string, schemas: Record<string, any>): Promise<ParsedStudy> {
  const moddle = new BpmnModdle(schemas);
  const definitions = looksLikeXml(text)
    ? (await moddle.fromXML(normalizeStudyflowXml(text))).rootElement
    : studyflowToDefinitions(text, moddle);

  // Spec-clean choreography files ship a bpmn:Choreography root; fold it back
  // to the process form the traversal below operates on.
  choreographyToProcessRoot(definitions);

  const businessObject = (definitions as any)?.rootElements?.find(
    (re: any) => re?.$type === 'bpmn:Process' || re?.$type === 'studyflow:Study',
  );
  if (!businessObject) throw new Error('No bpmn:Process found in diagram.');

  const flowNodes = new Map<string, FlowNode>();
  const sequenceFlows = new Map<string, SequenceFlow>();
  const scopes = new Map<string, Scope>();
  const rootScopeId = businessObject.id ?? 'process';

  /**
   * Walk one container's own flow elements, then recurse into each
   * sub-process. Nodes from every depth share the two flat maps — each
   * carries its `scopeId`, so the session can tell which scope instance it is
   * in without a second lookup structure.
   */
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

      // `conditionExpression` is BPMN's own expression element; older files
      // may still carry it as a flat string attribute.
      const rawCondition = el.get?.('conditionExpression') ?? el.conditionExpression;
      const condition = typeof rawCondition === 'string'
        ? rawCondition
        : rawCondition?.body ?? rawCondition?.get?.('body');

      sequenceFlows.set(el.id, {
        id: el.id,
        sourceId,
        targetId,
        conditionExpression: typeof condition === 'string' ? condition : undefined,
        businessObject: el,
      });

      flowNodes.get(sourceId)?.outgoing.push(el.id);
      flowNodes.get(targetId)?.incoming.push(el.id);
    }

    // A sub-process is both a node in its parent's flow and a scope of its own.
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
