import { BpmnModdle } from 'bpmn-moddle';
import { looksLikeXml, normalizeStudyflowXml, studyflowToDefinitions } from '../codec';
import { choreographyToProcessRoot } from '../codec/choreography';
import { getExtensionType } from '../extensions';
import type { FlowNode, SequenceFlow } from '../flow';

const FLOW_NODE_TYPES = new Set([
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:ManualTask',
  'bpmn:ChoreographyTask',
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
};

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
  let startId: string | undefined;

  for (const el of businessObject.flowElements ?? []) {
    if (el.$type === 'bpmn:SequenceFlow') continue;
    if (!FLOW_NODE_TYPES.has(el.$type)) continue;

    flowNodes.set(el.id, {
      id: el.id,
      type: el.$type,
      extensionType: getExtensionType(el),
      businessObject: el,
      outgoing: [],
      incoming: [],
    });

    if (el.$type === 'bpmn:StartEvent' && !startId) startId = el.id;
  }

  for (const el of businessObject.flowElements ?? []) {
    if (el.$type !== 'bpmn:SequenceFlow') continue;

    const sourceId = el.sourceRef?.id;
    const targetId = el.targetRef?.id;
    if (!sourceId || !targetId) continue;

    const condition = el.conditionExpression?.body
      ?? el.conditionExpression?.get?.('body');

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

  return { businessObject, flowNodes, sequenceFlows, startId };
}
