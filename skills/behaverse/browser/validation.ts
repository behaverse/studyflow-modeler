import { getBehaverseTaskPayload, readBehaverseAttribute } from '@skills/behaverse/browser/parser';
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
        + `Set scene to one of: ${manifest.tasks.map((t) => t.id).join(', ')}.`,
    }];
  }

  // Validate what the author wrote, not the payload the parser stripped.
  const authored = node.parameters;

  if (!payload.timeline && Object.keys(authored).length === 0) {
    issues.push({
      nodeId: node.id,
      message: `'${payload.scene}' names no timeline and reads no GameConfig from the Parameters wired into it, so it has no trials to run. `
        + 'Set its timeline to one the build ships (e.g. XCIT_NB_01), or define one inline under Timelines with its own blocks.',
    });
  }
  // What the build must ship: every timeline Timelines names without defining, and the one the task names unless defined inline.
  const timelines = authored.Timelines && typeof authored.Timelines === 'object' ? authored.Timelines as Record<string, unknown> : {};
  const byName = new Set(Object.keys(timelines).filter((name) => timelines[name] == null));
  const named = readBehaverseAttribute(node.businessObject, 'timeline');
  if (named && timelines[named] == null) byName.add(named);
  for (const name of byName) {
    if (manifestTask.timelines.includes(name)) continue;
    issues.push({
      nodeId: node.id,
      message: `'${payload.scene}' has no timeline called '${name}' in the Unity build. `
        + (manifestTask.timelines.length > 0
          ? `Use one of: ${manifestTask.timelines.join(', ')}.`
          : 'The build ships none for this task, so define the timeline inline.'),
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
