import * as yaml from 'js-yaml';
import { getAttribute } from '@/lib/core/extensions';
import type { FlowNode } from '@/lib/core/flow';
import type { BehaverseTaskPayload } from '@/runner/nodes/behaverse/types';

/** Read a behaverse attribute: resolved value, namespaced raw value, then bare raw value. */
export function readBehaverseAttribute(bo: any, attributeName: string): string | undefined {
  const resolved = getAttribute(bo, attributeName);
  if (typeof resolved === 'string' && resolved.length > 0) return resolved;

  const rawAttrs = bo?.$attrs;
  if (rawAttrs && typeof rawAttrs === 'object') {
    const namespaced = rawAttrs[`behaverse:${attributeName}`];
    if (typeof namespaced === 'string' && namespaced.length > 0) return namespaced;
    const bare = rawAttrs[attributeName];
    if (typeof bare === 'string' && bare.length > 0) return bare;
  }

  return undefined;
}

export function getBehaverseTaskPayload(node: FlowNode): BehaverseTaskPayload | null {
  if (node.extensionType !== 'behaverse:BehaverseTask') return null;

  const task = readBehaverseAttribute(node.businessObject, 'scene') ?? '';
  if (!task || task === 'undefined') {
    throw new Error(`BehaverseTask ${node.id} has no scene.`);
  }

  const configMode = (readBehaverseAttribute(node.businessObject, 'configMode') as 'builtin' | 'inline' | undefined)
    ?? 'builtin';
  const timelineId = readBehaverseAttribute(node.businessObject, 'timelineId');
  const configurations = readBehaverseAttribute(node.businessObject, 'configurations');
  const botConfig = readBehaverseAttribute(node.businessObject, 'botConfig');

  const agentMode = (readBehaverseAttribute(node.businessObject, 'agentMode') as 'human' | 'bot' | undefined)
    ?? 'human';

  const hasInlineBody = !!(configurations && configurations.trim());
  const hasTimelineId = !!(timelineId && timelineId.trim());

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
    payload.timeline = timelineId;
  } else if (hasInlineBody) {
    let parsed: unknown;
    try {
      parsed = yaml.load(configurations as string);
    } catch (err) {
      throw new Error(
        `BehaverseTask ${node.id}: failed to parse inline \`configurations\` YAML - ${(err as Error).message}`,
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(
        `BehaverseTask ${node.id}: inline \`configurations\` YAML must parse to an object (got ${Array.isArray(parsed) ? 'array' : typeof parsed}).`,
      );
    }
    const config = parsed as Record<string, unknown>;
    payload.config = config;
    // First timeline key keys the bridge's completion matcher.
    const timelines = config.Timelines as Record<string, unknown> | undefined;
    if (timelines && typeof timelines === 'object') {
      const firstTimelineKey = Object.keys(timelines)[0];
      if (firstTimelineKey) payload.timeline = firstTimelineKey;
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
