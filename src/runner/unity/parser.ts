import { BpmnModdle } from 'bpmn-moddle';
import * as yaml from 'js-yaml';
import { getAppliedType } from '@/v1/extensions/appliedType';
import { getExtensionElement } from '@/v1/extensions/wrapper';
import { getProperty } from '@/v1/extensions/resolve';
import type { RuntimeGraph, RuntimeNode, RuntimeEdge, BehaverseTaskPayload } from './types';

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
): Promise<RuntimeGraph> {
  const moddle = new BpmnModdle(schemas);
  const { rootElement } = await moddle.fromXML(xml);

  const process = (rootElement as any)?.rootElements?.find(
    (re: any) => re?.$type === 'bpmn:Process' || re?.$type === 'studyflow:Study',
  );
  if (!process) {
    throw new Error('No bpmn:Process / studyflow:Study found in diagram.');
  }

  const nodes = new Map<string, RuntimeNode>();
  const edges = new Map<string, RuntimeEdge>();
  let startId: string | undefined;

  for (const el of process.flowElements ?? []) {
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

  for (const el of process.flowElements ?? []) {
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

  return { process, nodes, edges, startId };
}

export function getBehaverseTaskPayload(node: RuntimeNode): BehaverseTaskPayload | null {
  if (node.appliedType !== 'behaverse:BehaverseTask') return null;

  const task = (getProperty(node.businessObject, 'scene') as string) || '';
  if (!task || task === 'undefined') {
    throw new Error(`BehaverseTask ${node.id} has no scene.`);
  }

  const configMode = (getProperty(node.businessObject, 'configMode') as 'timeline-ref' | 'inline')
    ?? 'timeline-ref';
  const timeline = getProperty(node.businessObject, 'timelineId') as string | undefined;
  const configurations = getProperty(node.businessObject, 'configurations') as string | undefined;

  return {
    task,
    timeline: configMode === 'timeline-ref' ? timeline : undefined,
    configMode,
    overrides: configMode === 'timeline-ref' ? parseYamlOverrides(configurations) : undefined,
    inlineConfig: configMode === 'inline' ? configurations : undefined,
  };
}

function parseYamlOverrides(text: string | undefined): Record<string, unknown> | undefined {
  if (!text || !text.trim()) return undefined;
  const parsed = yaml.load(text);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

export function ensureExtensionElementResolved(node: RuntimeNode): void {
  // Touch the lazy lookup so descriptor caching kicks in.
  getExtensionElement(node.businessObject);
}
