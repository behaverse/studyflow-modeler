import { getBehaverseTaskPayload } from './parser';
import type { Manifest, RuntimeGraph, ValidationIssue } from './types';

export async function fetchManifest(unityBuildUrl: string): Promise<Manifest> {
  // Unity puts Resources/* into the build under StreamingAssets/ at runtime, but
  // we serve it statically for the validator. The manifest path mirrors the
  // editor location so the runner can fetch it directly.
  const url = `${unityBuildUrl.replace(/\/$/, '')}/StreamingAssets/Studyflow/manifest.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load Unity manifest: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as Manifest;
}

export function validateGraph(graph: RuntimeGraph, manifest: Manifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tasksById = new Map(manifest.tasks.map((t) => [t.id, t]));

  for (const node of graph.nodes.values()) {
    if (node.appliedType !== 'behaverse:BehaverseTask') continue;

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
    }
  }

  return issues;
}
