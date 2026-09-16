import { getBehaverseTaskPayload } from '@skills/behaverse/browser/parser';
import type { FlowNode } from '@runner/flow';
import { RUNNER_ONLY_BOT_KEYS, type Manifest } from '@skills/behaverse/browser/types';
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
        + `Set instrument to one of: ${manifest.tasks.map((t) => t.id).join(', ')}.`,
    }];
  }

  // Validate what the author wrote, not the payload the parser stripped.
  const authored = node.parameters;

  // The timeline that runs is defined in the wired Parameters, or the build ships it for the instrument.
  const timelines = authored.Timelines && typeof authored.Timelines === 'object' ? authored.Timelines as Record<string, unknown> : {};
  if (!(payload.timeline in timelines) && !manifestTask.timelines.includes(payload.timeline)) {
    issues.push({
      nodeId: node.id,
      message: `'${payload.scene}' has no timeline called '${payload.timeline}' in the Unity build. `
        + (manifestTask.timelines.length > 0
          ? `Use one of: ${manifestTask.timelines.join(', ')}, or define it under Timelines in the Parameters wired into the task.`
          : 'The build ships none for this task, so define it under Timelines in the Parameters wired into the task.'),
    });
  }

  // `Bot:` reaches Unity's per-task Bot field by field, so it must be one flat mapping (runner-only keys aside).
  const bot = authored.Bot;
  if (bot != null) {
    if (typeof bot !== 'object' || Array.isArray(bot)) {
      issues.push({
        nodeId: node.id,
        message: `Bot in the Parameters wired into '${payload.scene}' must be a mapping of setting names to values, `
          + `one per line (got ${Array.isArray(bot) ? 'a list' : typeof bot}).`,
      });
    } else {
      const runnerOnly = new Set<string>(RUNNER_ONLY_BOT_KEYS);
      for (const [k, v] of Object.entries(bot as Record<string, unknown>)) {
        if (runnerOnly.has(k)) continue;
        if (v !== null && typeof v === 'object') {
          issues.push({
            nodeId: node.id,
            message: `Bot in the Parameters wired into '${payload.scene}' must stay flat, but '${k}' holds a nested ${Array.isArray(v) ? 'list' : 'mapping'}. `
              + 'Move its entries up to top-level Bot settings.',
          });
          break;
        }
      }
    }
  }

  return issues;
}
