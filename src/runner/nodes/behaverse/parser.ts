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

/** Read the YAML body carried by a `cognitive:Configurations` wrapper child element.
 *  `getAttribute` unwraps the wrapper to its body string, so this is currently
 *  identical to `readBehaverseAttribute` and exists as a clearer call site. */
export function readBehaverseBody(bo: any, propertyName: string): string | undefined {
  return readBehaverseAttribute(bo, propertyName);
}

export function getBehaverseTaskPayload(node: FlowNode): BehaverseTaskPayload | null {
  if (node.extensionType !== 'behaverse:Task') return null;

  const scene = readBehaverseAttribute(node.businessObject, 'scene') ?? '';
  if (!scene || scene === 'undefined') {
    throw new Error(`Behaverse task ${node.id} has no scene.`);
  }

  const configurations = readBehaverseBody(node.businessObject, 'configurations');
  const botConfigurations = readBehaverseBody(node.businessObject, 'botConfigurations');

  const agentType = (readBehaverseAttribute(node.businessObject, 'agentType') as 'human' | 'bot' | undefined)
    ?? 'human';

  const payload: BehaverseTaskPayload = {
    scene,
    agentType,
    metadata: { studyflowNodeId: node.id },
  };

  if (configurations && configurations.trim()) {
    let parsed: unknown;
    try {
      parsed = yaml.load(configurations);
    } catch (err) {
      throw new Error(
        `Behaverse task ${node.id}: failed to parse \`configurations\` YAML - ${(err as Error).message}`,
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(
        `Behaverse task ${node.id}: \`configurations\` YAML must parse to an object (got ${Array.isArray(parsed) ? 'array' : typeof parsed}).`,
      );
    }
    const parameters = parsed as Record<string, unknown>;
    payload.parameters = parameters;
    // First timeline key keys the bridge's completion matcher. A build-shipped
    // timeline is listed by name only; an inline one carries its own definition.
    const timelines = parameters.Timelines as Record<string, unknown> | undefined;
    if (timelines && typeof timelines === 'object') {
      const firstTimelineKey = Object.keys(timelines)[0];
      if (firstTimelineKey) payload.timeline = firstTimelineKey;
    }
  }

  if (agentType === 'bot') {
    const bot = parseYamlOverrides(botConfigurations);
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
