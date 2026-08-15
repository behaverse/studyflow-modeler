import { getCatalog, hasCatalog } from '@core/notation';
import type { Studyflow } from '@runner/studyflow';
import { BEHAVERSE_RUNTIME_URL, type Manifest } from '@runner/nodes/behaverse/types';
import { fetchManifest } from '@runner/nodes/behaverse/validation';
import type { AnyNodeDefinition, LogFn, ValidationIssue } from '@runner/nodes/types';
import { findByFlowNode, getRegisteredNodes } from '@runner/nodes/registry';

// Auto-discovery: each `<kind>/index.tsx` self-registers as a side effect of being imported here.
import.meta.glob('./*/index.tsx', { eager: true });

export { registerNode, findByFlowNode } from '@runner/nodes/registry';

export function findByType(type: string): AnyNodeDefinition | undefined {
  return getRegisteredNodes().find((n) => n.type === type);
}

/** Behaverse nodes check themselves against the Unity build; fetched here so callers never handle a manifest. */
async function loadManifest(studyflow: Studyflow, log: LogFn): Promise<Manifest | undefined> {
  const needed = [...studyflow.flowNodes.values()]
    .some((node) => findByFlowNode(node)?.type === 'behaverse');
  if (!needed) {
    log('info', 'No Behaverse task in this studyflow.');
    return undefined;
  }
  try {
    return await fetchManifest(BEHAVERSE_RUNTIME_URL);
  } catch (err) {
    log(
      'skip',
      `Could not load the Behaverse Unity build (${err instanceof Error ? err.message : String(err)}). `,
    );
    return undefined;
  }
}

/** `meta.branching` off the schema, when a catalog is installed (it is not, in Node-side unit tests). */
function branchingMode(extensionType: string): string | undefined {
  if (!hasCatalog()) return undefined;
  const mode = getCatalog().getType(extensionType)?.meta?.branching;
  return typeof mode === 'string' ? mode : undefined;
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
        // A model-decided branch is refused mid-run (see session.ts), so don't promise the run continues.
        message: branchingMode(node.extensionType) === 'model'
          ? `'${node.extensionType}' picks its branch with a model, which the runner does not implement. The run stops here.`
          : `'${node.extensionType}' is not executable in this runner. This step is skipped and the run continues.`,
      });
    }
  }
  return issues;
}
