import * as yaml from 'js-yaml';
import { getBehaverseTaskPayload, readBehaverseAttribute } from '@runner/nodes/behaverse/parser';
import type { FlowNode } from '@runner/flow';
import { RUNNER_ONLY_BOT_KEYS, type Manifest } from '@runner/nodes/behaverse/types';
import type { ValidationIssue } from '@runner/nodes/types';

export async function fetchManifest(unityBuildUrl: string): Promise<Manifest> {
  const url = `${unityBuildUrl.replace(/\/$/, '')}/StreamingAssets/Studyflow/manifest.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status} ${response.statusText}`);
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
      message: `The Unity build ships no task called '${payload.scene}'. `
        + `Set behaverseScene to one of: ${manifest.tasks.map((t) => t.id).join(', ')}.`,
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
      message: `'${payload.scene}' has no configurations, so it has no trials to run. `
        + 'Under Timelines, name a timeline the build ships (e.g. XCIT_NB_01), or define one inline with its own blocks.',
    });
  } else {
    const timelines = authored.Timelines as Record<string, unknown> | undefined;
    if (timelines && typeof timelines === 'object') {
      for (const [name, def] of Object.entries(timelines)) {
        if (def == null && !manifestTask.timelines.includes(name)) {
          issues.push({
            nodeId: node.id,
            message: `'${payload.scene}' has no timeline called '${name}' in the Unity build. `
              + (manifestTask.timelines.length > 0
                ? `Use one of: ${manifestTask.timelines.join(', ')}.`
                : 'The build ships none for this task, so define the timeline inline.'),
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
          message: `botConfigurations on '${payload.scene}' is not valid YAML: ${(err as Error).message}. Check the indentation and quoting.`,
        });
        return issues;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        issues.push({
          nodeId: node.id,
          message: `botConfigurations on '${payload.scene}' must be a mapping of setting names to values, `
            + `one per line (got ${Array.isArray(parsed) ? 'a list' : typeof parsed}).`,
        });
        return issues;
      }
      const runnerOnly = new Set<string>(RUNNER_ONLY_BOT_KEYS);
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (runnerOnly.has(k)) continue;
        if (v !== null && typeof v === 'object') {
          issues.push({
            nodeId: node.id,
            message: `botConfigurations on '${payload.scene}' must stay flat, but '${k}' holds a nested ${Array.isArray(v) ? 'list' : 'mapping'}. `
              + 'Move its entries up to top-level settings.',
          });
          break;
        }
      }
    }
  }

  return issues;
}
