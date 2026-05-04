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
  const timelineId = readBehaverseProperty(node.businessObject, 'timelineId');
  const configurations = readBehaverseProperty(node.businessObject, 'configurations');
  const botConfig = readBehaverseProperty(node.businessObject, 'bot');

  // `agentMode` is a string Enum, so moddle keeps it as a string on both
  // the property and the raw $attrs map — `readBehaverseProperty` handles
  // both. Default to `human` when absent (legacy diagrams without the attr).
  const agentMode = (readBehaverseProperty(node.businessObject, 'agentMode') as 'human' | 'bot' | undefined)
    ?? 'human';

  const hasInlineBody = !!(configurations && configurations.trim());
  const hasTimelineId = !!(timelineId && timelineId.trim());

  // b1 mutually-exclusive rule: timelineId vs. inline configurations body.
  if (hasTimelineId && hasInlineBody) {
    throw new Error(
      `BehaverseTask ${node.id}: cannot mix \`timelineId\` and a non-empty \`configurations\` body. Pick one (configMode=builtin uses timelineId; configMode=inline uses configurations).`,
    );
  }

  const payload: BehaverseTaskPayload = {
    task,
    configMode,
    agentMode,
    metadata: { studyflowNodeId: node.id },
  };

  if (configMode === 'builtin') {
    // Pass timelineId through (may be empty — validator surfaces that as a
    // structured issue; parser only throws for diagrams that are unrunnable:
    // no scene, mixed b1, or bad inline/bot YAML).
    payload.timeline = timelineId;
  } else {
    // inline: parse the full GameConfig YAML body to a JSON object.
    if (hasInlineBody) {
      let parsed: unknown;
      try {
        parsed = yaml.load(configurations as string);
      } catch (err) {
        throw new Error(
          `BehaverseTask ${node.id}: failed to parse inline \`configurations\` YAML — ${(err as Error).message}`,
        );
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(
          `BehaverseTask ${node.id}: inline \`configurations\` YAML must parse to an object (got ${Array.isArray(parsed) ? 'array' : typeof parsed}).`,
        );
      }
      const config = parsed as Record<string, unknown>;
      payload.config = config;
      // Pre-resolve the timeline name from the inline config so the bridge's
      // completion matcher can key on it (otherwise it falls back to "any
      // completion event matching the task" which clobbers the log with the
      // previous task's timeline). Unity-side has the same default behavior;
      // we just mirror it here for log fidelity.
      const timelines = config.Timelines as Record<string, unknown> | undefined;
      if (timelines && typeof timelines === 'object') {
        const firstTimelineKey = Object.keys(timelines)[0];
        if (firstTimelineKey) payload.timeline = firstTimelineKey;
      }
    }
  }

  if (agentMode === 'bot') {
    const bot = parseYamlOverrides(botConfig);
    if (bot) payload.bot = bot;
  }

  return payload;
}

function parseYamlOverrides(text: string | undefined): Record<string, unknown> | undefined {
  if (!text || !text.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = yaml.load(text);
  } catch {
    return undefined;
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

export function ensureExtensionElementResolved(node: RuntimeNode): void {
  // Touch the lazy lookup so descriptor caching kicks in.
  getExtensionElement(node.businessObject);
}
