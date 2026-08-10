import * as yaml from 'js-yaml';
import { getBehaverseTaskPayload, readBehaverseAttribute } from '@/runner/nodes/behaverse/parser';
import type { FlowNode } from '@/runner/flow';
import { RUNNER_ONLY_BOT_KEYS, type Manifest } from '@/runner/nodes/behaverse/types';
import type { ValidationIssue } from '@/runner/nodes/types';

export async function fetchManifest(unityBuildUrl: string): Promise<Manifest> {
  const url = `${unityBuildUrl.replace(/\/$/, '')}/StreamingAssets/Studyflow/manifest.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load Unity manifest: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as Manifest;
}

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
      message: `Unknown task '${payload.scene}' (not in Unity manifest).`,
    }];
  }

  // Validate what the author wrote, not the payload the parser stripped; it already parsed this YAML, so it cannot throw.
  const rawConfigurations = readBehaverseAttribute(node.businessObject, 'configurations');
  const authored = rawConfigurations && rawConfigurations.trim()
    ? (yaml.load(rawConfigurations) as Record<string, unknown>)
    : undefined;

  if (!authored || Object.keys(authored).length === 0) {
    issues.push({
      nodeId: node.id,
      message: `Empty configurations on '${payload.scene}'. Provide a GameConfig YAML body - list a build-shipped timeline by name under Timelines (e.g. XCIT_NB_01), or define one inline with its own blocks.`,
    });
  } else {
    const timelines = authored.Timelines as Record<string, unknown> | undefined;
    if (timelines && typeof timelines === 'object') {
      for (const [name, def] of Object.entries(timelines)) {
        if (def == null && !manifestTask.timelines.includes(name)) {
          issues.push({
            nodeId: node.id,
            message: `Unknown timeline '${name}' for task '${payload.scene}'.`,
          });
        }
      }
    }
  }

  if (payload.agentType === 'bot') {
    const raw = readBehaverseAttribute(node.businessObject, 'botConfigurations');
    if (raw && raw.trim()) {
      let parsed: unknown;
      try {
        parsed = yaml.load(raw);
      } catch (err) {
        issues.push({
          nodeId: node.id,
          message: `Invalid bot YAML on '${payload.scene}': ${(err as Error).message}`,
        });
        return issues;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        issues.push({
          nodeId: node.id,
          message: `bot YAML on '${payload.scene}' must be a flat object (got ${Array.isArray(parsed) ? 'array' : typeof parsed}).`,
        });
        return issues;
      }
      const runnerOnly = new Set<string>(RUNNER_ONLY_BOT_KEYS);
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (runnerOnly.has(k)) continue;
        if (v !== null && typeof v === 'object') {
          issues.push({
            nodeId: node.id,
            message: `bot YAML on '${payload.scene}' must be flat (no nested objects/arrays) - key '${k}' has a nested ${Array.isArray(v) ? 'array' : 'object'}.`,
          });
          break;
        }
      }
    }
  }

  return issues;
}
