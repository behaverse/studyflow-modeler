import { BpmnModdle } from 'bpmn-moddle';
import { getAppliedType } from '@/modeler/extensions/appliedType';
import type { Process, FlowNode, SequenceFlow } from './types';

const FLOW_NODE_TYPES = new Set([
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:ManualTask',
  'bpmn:ExclusiveGateway',
  'bpmn:InclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:EventBasedGateway',
  'bpmn:IntermediateThrowEvent',
  'bpmn:IntermediateCatchEvent',
]);

export async function parseStudyflow(
  xml: string,
  schemas: Record<string, any>,
): Promise<Process> {
  const moddle = new BpmnModdle(schemas);
  const { rootElement } = await moddle.fromXML(xml);

  const businessObject = (rootElement as any)?.rootElements?.find(
    (re: any) => re?.$type === 'bpmn:Process' || re?.$type === 'studyflow:Study',
  );
  if (!businessObject) {
    throw new Error('No bpmn:Process / studyflow:Study found in diagram.');
  }

  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, SequenceFlow>();
  let startId: string | undefined;

  for (const el of businessObject.flowElements ?? []) {
    if (el.$type === 'bpmn:SequenceFlow') continue;
    if (!FLOW_NODE_TYPES.has(el.$type)) continue;

    nodes.set(el.id, {
      id: el.id,
      type: el.$type,
      appliedType: getAppliedType(el),
      businessObject: el,
      outgoing: [],
      incoming: [],
    });

    if (el.$type === 'bpmn:StartEvent' && !startId) {
      startId = el.id;
    }
  }

  for (const el of businessObject.flowElements ?? []) {
    if (el.$type !== 'bpmn:SequenceFlow') continue;

    const sourceId = el.sourceRef?.id;
    const targetId = el.targetRef?.id;
    if (!sourceId || !targetId) continue;

    const condition = el.conditionExpression?.body
      ?? el.conditionExpression?.get?.('body');

    edges.set(el.id, {
      id: el.id,
      sourceId,
      targetId,
      conditionExpression: typeof condition === 'string' ? condition : undefined,
      businessObject: el,
    });

    nodes.get(sourceId)?.outgoing.push(el.id);
    nodes.get(targetId)?.incoming.push(el.id);
  }

  return { businessObject, nodes, edges, startId };
}
