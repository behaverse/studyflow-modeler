import * as yaml from 'js-yaml';
import { getAttribute } from '@core/element';
import type { FlowNode } from '@runner/flow';
import type { Session } from '@runner/session';
import { BEHAVERSE_TASK_TYPE, type BehaverseTaskPayload } from '@runner/nodes/behaverse/types';

/** Who is running what: Unity stamps these onto every event it records. */
export function withRunIdentity(
  payload: BehaverseTaskPayload,
  session: Session,
): BehaverseTaskPayload {
  const { agentId, sessionId, studyflow } = session;
  return {
    ...payload,
    ...(agentId ? { agent: { id: agentId } } : {}),
    ...(studyflow.studyId ? { studyId: studyflow.studyId } : {}),
    ...(studyflow.studyflowId ? { studyflowId: studyflow.studyflowId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(studyflow.studyflowHash ? { studyflowHash: studyflow.studyflowHash } : {}),
  };
}

export function readBehaverseAttribute(bo: any, attributeName: string): string | undefined {
  const resolved = getAttribute(bo, attributeName);
  if (typeof resolved === 'string' && resolved.length > 0) return resolved;

  const rawAttrs = bo?.$attrs;
  if (rawAttrs && typeof rawAttrs === 'object') {
    const namespaced = rawAttrs[`cognitive:${attributeName}`];
    if (typeof namespaced === 'string' && namespaced.length > 0) return namespaced;
    const bare = rawAttrs[attributeName];
    if (typeof bare === 'string' && bare.length > 0) return bare;
  }

  return undefined;
}

export function getBehaverseTaskPayload(node: FlowNode): BehaverseTaskPayload | null {
  if (node.extensionType !== BEHAVERSE_TASK_TYPE) return null;

  const scene = readBehaverseAttribute(node.businessObject, 'behaverseScene') ?? '';
  if (!scene || scene === 'undefined') {
    throw new Error(
      `BehaverseTask '${node.id}' has no scene, so the browser runner cannot tell which task to load. `
      + 'Set behaverseScene to a task the Unity build ships.',
    );
  }

  const configurations = readBehaverseAttribute(node.businessObject, 'configurations');
  const botConfigurations = readBehaverseAttribute(node.businessObject, 'botConfigurations');

  const agentType = (readBehaverseAttribute(node.businessObject, 'agentType') as 'human' | 'bot' | undefined)
    ?? 'human';

  const payload: BehaverseTaskPayload = {
    scene,
    agentType,
    configMode: 'builtin',
    metadata: { studyflowNodeId: node.id },
  };

  if (configurations && configurations.trim()) {
    let parsed: unknown;
    try {
      parsed = yaml.load(configurations);
    } catch (err) {
      throw new Error(
        `configurations on BehaverseTask '${node.id}' is not valid YAML: ${(err as Error).message}. `
        + 'Check the indentation and quoting.',
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(
        `configurations on BehaverseTask '${node.id}' must be a mapping of setting names to values `
        + `(got ${Array.isArray(parsed) ? 'a list' : typeof parsed}).`,
      );
    }
    const parameters = { ...(parsed as Record<string, unknown>) };
    // First timeline key names what Unity runs and keys the bridge's completion matcher.
    const timelines = parameters.Timelines as Record<string, unknown> | undefined;
    if (timelines && typeof timelines === 'object') {
      const firstTimelineKey = Object.keys(timelines)[0];
      if (firstTimelineKey) payload.timeline = firstTimelineKey;
      // Unity null-merges `parameters` over Resources/<scene>.json, so a `{Name: null}` entry would erase that timeline.
      const inlineTimelines = Object.fromEntries(
        Object.entries(timelines).filter(([, definition]) => definition != null),
      );
      if (Object.keys(inlineTimelines).length > 0) parameters.Timelines = inlineTimelines;
      else delete parameters.Timelines;
    }
    if (Object.keys(parameters).length > 0) {
      payload.configMode = 'inline';
      payload.parameters = parameters;
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
