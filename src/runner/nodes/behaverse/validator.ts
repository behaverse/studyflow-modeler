import * as yaml from 'js-yaml';
import { getBehaverseTaskPayload, readBehaverseAttribute } from './parser';
import type { Studyflow } from '@/runner/studyflow';
import { RUNNER_ONLY_BOT_KEYS, type Manifest } from '@/runner/nodes/behaverse/types';
import type { ValidationIssue } from '@/runner/nodes/types';

export async function fetchManifest(unityBuildUrl: string): Promise<Manifest> {
  // Manifest path mirrors Unity's StreamingAssets layout so the runner can fetch it directly.
  const url = `${unityBuildUrl.replace(/\/$/, '')}/StreamingAssets/Studyflow/manifest.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load Unity manifest: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as Manifest;
}

export function validateStudyflow(studyflow: Studyflow, manifest: Manifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tasksById = new Map(manifest.tasks.map((t) => [t.id, t]));

  for (const node of studyflow.flowNodes.values()) {
    if (node.extensionType !== 'behaverse:BehaverseTask') continue;

    let payload;
    try {
      payload = getBehaverseTaskPayload(node);
    } catch (err) {
      issues.push({ nodeId: node.id, message: (err as Error).message });
      continue;
    }
    if (!payload) continue;

    const manifestTask = tasksById.get(payload.task);
    if (!manifestTask) {
      issues.push({
        nodeId: node.id,
        taskId: payload.task,
        message: `Unknown task '${payload.task}' (not in Unity manifest).`,
      });
      continue;
    }

    if (payload.configMode === 'builtin') {
      if (!payload.timeline) {
        issues.push({
          nodeId: node.id,
          taskId: payload.task,
          message: `Missing timelineId on '${payload.task}' (configMode=builtin).`,
        });
      } else if (!manifestTask.timelines.includes(payload.timeline)) {
        issues.push({
          nodeId: node.id,
          taskId: payload.task,
          timelineId: payload.timeline,
          message: `Unknown timeline '${payload.timeline}' for task '${payload.task}'.`,
        });
      }
    } else if (payload.configMode === 'inline') {
      if (!payload.config || Object.keys(payload.config).length === 0) {
        issues.push({
          nodeId: node.id,
          taskId: payload.task,
          message: `Empty inline configurations on '${payload.task}' (configMode=inline). Provide a GameConfig override YAML body (e.g. Blocks/Timelines that diverge from Resources/${payload.task}.json).`,
        });
      }
    }

    // Bot validation: when agentMode is 'bot', the YAML must parse to a flat object.
    if (payload.agentMode === 'bot') {
      const raw = readBehaverseAttribute(node.businessObject, 'botConfig');
      if (raw && raw.trim()) {
        let parsed: unknown;
        try {
          parsed = yaml.load(raw);
        } catch (err) {
          issues.push({
            nodeId: node.id,
            taskId: payload.task,
            message: `Invalid bot YAML on '${payload.task}': ${(err as Error).message}`,
          });
          continue;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          issues.push({
            nodeId: node.id,
            taskId: payload.task,
            message: `bot YAML on '${payload.task}' must be a flat object (got ${Array.isArray(parsed) ? 'array' : typeof parsed}).`,
          });
          continue;
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
              taskId: payload.task,
              message: `bot YAML on '${payload.task}' must be flat (no nested objects/arrays) - key '${k}' has a nested ${Array.isArray(v) ? 'array' : 'object'}.`,
            });
            break;
          }
        }
      }
    }
  }

  return issues;
}
