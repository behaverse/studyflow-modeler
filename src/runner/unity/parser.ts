import { BpmnModdle } from 'bpmn-moddle';
import * as yaml from 'js-yaml';
import { getAppliedType } from '@/modeler/extensions/appliedType';
import { getExtensionElement } from '@/modeler/extensions/wrapper';
import { getProperty } from '@/modeler/extensions/resolve';
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

function readBehaverseProperty(businessObject: any, propertyName: string): string | undefined {
  const fromProperty = getProperty(businessObject, propertyName);
  if (typeof fromProperty === 'string' && fromProperty.length > 0) return fromProperty;

  const attrs = businessObject?.$attrs;
  if (attrs && typeof attrs === 'object') {
    const namespaced = attrs[`behaverse:${propertyName}`];
    if (typeof namespaced === 'string' && namespaced.length > 0) return namespaced;
    const bare = attrs[propertyName];
    if (typeof bare === 'string' && bare.length > 0) return bare;
  }

  return typeof fromProperty === 'string' ? fromProperty : undefined;
}

export function getBehaverseTaskPayload(node: RuntimeNode): BehaverseTaskPayload | null {
  if (node.appliedType !== 'behaverse:BehaverseTask') return null;

  const task = readBehaverseProperty(node.businessObject, 'scene') ?? '';
  if (!task || task === 'undefined') {
    throw new Error(`BehaverseTask ${node.id} has no scene.`);
  }

  const configMode = (readBehaverseProperty(node.businessObject, 'configMode') as 'builtin' | 'inline' | undefined)
    ?? 'builtin';
  const timeline = readBehaverseProperty(node.businessObject, 'timelineId');
  const configurations = readBehaverseProperty(node.businessObject, 'configurations');

  return {
    task,
    timeline: configMode === 'builtin' ? timeline : undefined,
    configMode,
    overrides: configMode === 'builtin' ? parseYamlOverrides(configurations) : undefined,
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
