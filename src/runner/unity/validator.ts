import * as yaml from 'js-yaml';
import { getBehaverseTaskPayload } from './parser';
import { getProperty } from '@/modeler/extensions/resolve';
import type { Manifest, RuntimeGraph, ValidationIssue } from './types';

function readAttr(businessObject: any, name: string): string | undefined {
  const fromProperty = getProperty(businessObject, name);
  if (typeof fromProperty === 'string' && fromProperty.length > 0) return fromProperty;
  const attrs = businessObject?.$attrs;
  if (attrs && typeof attrs === 'object') {
    const namespaced = attrs[`behaverse:${name}`];
    if (typeof namespaced === 'string' && namespaced.length > 0) return namespaced;
    const bare = attrs[name];
    if (typeof bare === 'string' && bare.length > 0) return bare;
  }
  return undefined;
}

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
    } else if (payload.configMode === 'inline') {
      if (!payload.config || Object.keys(payload.config).length === 0) {
        issues.push({
          nodeId: node.id,
          taskId: payload.task,
          message: `Empty inline configurations on '${payload.task}' (configMode=inline). Provide a GameConfig YAML body.`,
        });
      }
    }

    // Bot validation: when agentMode is 'bot', the YAML must parse to a flat object.
    if (payload.agentMode === 'bot') {
      const raw = readAttr(node.businessObject, 'bot');
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
        // Reject nested values — bot fields are flat scalars (string|number|boolean).
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (v !== null && typeof v === 'object') {
            issues.push({
              nodeId: node.id,
              taskId: payload.task,
              message: `bot YAML on '${payload.task}' must be flat (no nested objects/arrays) — key '${k}' has a nested ${Array.isArray(v) ? 'array' : 'object'}.`,
            });
            break;
          }
        }
      }
    }
  }

  return issues;
}
