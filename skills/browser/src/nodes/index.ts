import { getCatalog, hasCatalog } from '@core/notation';
import { parseSkillManifest } from '@core/notation/skill';
import { validateAllocation } from '@runner/allocation';
import type { Studyflow } from '@runner/studyflow';
import type { AnyNodeDefinition, LogFn, ValidationIssue } from '@runner/nodes/types';
import { findByFlowNode, getRegisteredNodes } from '@runner/nodes/registry';

// Auto-discovery: each `<kind>/index.tsx` here self-registers as a side effect of being imported.
import.meta.glob('./*/index.tsx', { eager: true });

// The other skills' modules: whatever each `SKILL.md` names as `runtimes.browser`, imported so it
// registers itself the same way. This runtime's own sources are not a skill module.
const manifests = import.meta.glob('@skills/*/SKILL.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const modules = import.meta.glob(['@skills/*/**/*.tsx', '!@skills/browser/**']);

export const skillModulesLoaded: Promise<void> = (async () => {
  for (const [path, source] of Object.entries(manifests)) {
    // This runtime's own root is a skill folder, so its manifest is `/SKILL.md`: no folder to check against.
    const skill = parseSkillManifest(source, path.split('/').at(-2) || undefined);
    const entry = skill.runtimes?.browser;
    if (typeof entry !== 'string') continue;
    const key = Object.keys(modules).find((candidate) => candidate.endsWith(`/${skill.name}/${entry}`));
    if (!key) {
      console.error(`[studyflow skill] ${skill.name}/SKILL.md names runtimes.browser ${entry}, but there is no such module`);
      continue;
    }
    await modules[key]();
  }
})();

export { registerNode, findByFlowNode } from '@runner/nodes/registry';

export function findByType(type: string): AnyNodeDefinition | undefined {
  return getRegisteredNodes().find((n) => n.type === type);
}

/** `meta.branching` off the schema, when a catalog is installed (it is not, in Node-side unit tests). */
function branchingMode(extensionType: string): string | undefined {
  if (!hasCatalog()) return undefined;
  const mode = getCatalog().getType(extensionType)?.meta?.branching;
  return typeof mode === 'string' ? mode : undefined;
}

export async function validate(studyflow: Studyflow, log: LogFn): Promise<ValidationIssue[]> {
  await skillModulesLoaded;
  const issues: ValidationIssue[] = [];

  // What a definition prepares (a build manifest, say) goes to its own validators and nowhere else.
  const contexts = new Map<AnyNodeDefinition, unknown>();
  for (const def of getRegisteredNodes()) {
    const context = def.prepare ? await def.prepare(studyflow, log) : undefined;
    contexts.set(def, context);
    issues.push(...(def.validateStudyflow?.(studyflow, context) ?? []));
  }

  for (const node of studyflow.flowNodes.values()) {
    const def = findByFlowNode(node);
    if (def?.validateNode) issues.push(...def.validateNode(node, studyflow, contexts.get(def)));

    // Gateways have no node module of their own, so their allocation is checked here.
    issues.push(...validateAllocation(node));

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
