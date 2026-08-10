import type { Studyflow } from '@/runner/studyflow';
import { BEHAVERSE_RUNTIME_URL, type Manifest } from '@/runner/nodes/behaverse/types';
import { fetchManifest } from '@/runner/nodes/behaverse/validation';
import type { AnyNodeDefinition, LogFn, ValidationIssue } from '@/runner/nodes/types';
import { findByFlowNode, getRegisteredNodes } from '@/runner/nodes/registry';

// Auto-discovery: each `<kind>/index.tsx` self-registers as a side effect of being imported here.
import.meta.glob('./*/index.tsx', { eager: true });

export { registerNode, findByFlowNode } from '@/runner/nodes/registry';

export function findByType(type: string): AnyNodeDefinition | undefined {
  return getRegisteredNodes().find((n) => n.type === type);
}

/** Behaverse nodes check themselves against the Unity build; fetched here so callers never handle a manifest. */
async function loadManifest(studyflow: Studyflow, log: LogFn): Promise<Manifest | undefined> {
  const needed = [...studyflow.flowNodes.values()]
    .some((node) => findByFlowNode(node)?.type === 'behaverse');
  if (!needed) {
    log('info', 'No behaverse tasks - skipping Unity manifest.');
    return undefined;
  }
  try {
    return await fetchManifest(BEHAVERSE_RUNTIME_URL);
  } catch (err) {
    log(
      'skip',
      `Could not load the Unity manifest (${err instanceof Error ? err.message : String(err)}); `
      + 'behaverse tasks will not be verified against the build.',
    );
    return undefined;
  }
}

export async function validate(studyflow: Studyflow, log: LogFn): Promise<ValidationIssue[]> {
  const manifest = await loadManifest(studyflow, log);
  const issues = getRegisteredNodes().flatMap((n) => n.validateStudyflow?.(studyflow, manifest) ?? []);

  for (const node of studyflow.flowNodes.values()) {
    const def = findByFlowNode(node);
    if (def?.validateNode) issues.push(...def.validateNode(node, studyflow, manifest));

    if (!def && node.extensionType) {
      issues.push({
        nodeId: node.id,
        severity: 'warning',
        message: `No runner module handles '${node.extensionType}', so this step will be skipped.`,
      });
    }
  }
  return issues;
}
