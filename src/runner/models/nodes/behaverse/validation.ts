import * as yaml from 'js-yaml';
import { getBehaverseTaskPayload, readBehaverseBody } from '@/runner/models/nodes/behaverse/parser';
import type { FlowNode } from '@/runner/models/flow';
import { RUNNER_ONLY_BOT_KEYS, type Manifest } from '@/runner/models/nodes/behaverse/types';
import type { ValidationIssue } from '@/runner/models/nodes/types';

export async function fetchManifest(unityBuildUrl: string): Promise<Manifest> {
  // Manifest path mirrors Unity's StreamingAssets layout so the runner can fetch it directly.
  const url = `${unityBuildUrl.replace(/\/$/, '')}/StreamingAssets/Studyflow/manifest.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load Unity manifest: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as Manifest;
}

/** Validate one behaverse task node against the Unity manifest. */
export function validateBehaverseNode(node: FlowNode, manifest: Manifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  let payload;
  try {
    payload = getBehaverseTaskPayload(node);
  } catch (err) {
    return [{ nodeId: node.id, message: (err as Error).message }];
  }
  if (!payload) return issues;

  const manifestTask = manifest.tasks.find((t) => t.id === payload.scene);
  if (!manifestTask) {
    return [{
      nodeId: node.id,
      taskId: payload.scene,
      message: `Unknown task '${payload.scene}' (not in Unity manifest).`,
    }];
  }

  if (!payload.parameters || Object.keys(payload.parameters).length === 0) {
    issues.push({
      nodeId: node.id,
      taskId: payload.scene,
      message: `Empty configurations on '${payload.scene}'. Provide a GameConfig YAML body - list a build-shipped timeline by name under Timelines (e.g. XCIT_NB_01), or define one inline with its own blocks.`,
    });
  } else {
    // A timeline listed by name only (null body) references one shipped with
    // the build, so validate it against the manifest. A timeline with its own
    // definition is run inline and won't be in the manifest - skip it.
    const timelines = payload.parameters.Timelines as Record<string, unknown> | undefined;
    if (timelines && typeof timelines === 'object') {
      for (const [name, def] of Object.entries(timelines)) {
        if (def == null && !manifestTask.timelines.includes(name)) {
          issues.push({
            nodeId: node.id,
            taskId: payload.scene,
            timelineId: name,
            message: `Unknown timeline '${name}' for task '${payload.scene}'.`,
          });
        }
      }
    }
  }

  // Bot validation: when agentType is 'bot', the YAML must parse to a flat object.
  if (payload.agentType === 'bot') {
    const raw = readBehaverseBody(node.businessObject, 'botConfigurations');
    if (raw && raw.trim()) {
      let parsed: unknown;
      try {
        parsed = yaml.load(raw);
      } catch (err) {
        issues.push({
          nodeId: node.id,
          taskId: payload.scene,
          message: `Invalid bot YAML on '${payload.scene}': ${(err as Error).message}`,
        });
        return issues;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        issues.push({
          nodeId: node.id,
          taskId: payload.scene,
          message: `bot YAML on '${payload.scene}' must be a flat object (got ${Array.isArray(parsed) ? 'array' : typeof parsed}).`,
        });
        return issues;
      }
      // Reject nested values - Unity-bound bot fields are flat scalars
      // (BotReflection applies them by name). Runner-only keys are exempt:
      // they're consumed by the studyflow runner, not forwarded to Unity for
      // reflection, so nesting is fine.
      const runnerOnly = new Set<string>(RUNNER_ONLY_BOT_KEYS);
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (runnerOnly.has(k)) continue;
        if (v !== null && typeof v === 'object') {
          issues.push({
            nodeId: node.id,
            taskId: payload.scene,
            message: `bot YAML on '${payload.scene}' must be flat (no nested objects/arrays) - key '${k}' has a nested ${Array.isArray(v) ? 'array' : 'object'}.`,
          });
          break;
        }
      }
    }
  }

  return issues;
}
