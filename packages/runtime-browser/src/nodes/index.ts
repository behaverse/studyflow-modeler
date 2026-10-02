import { checkEntryExit } from '@core/checks/entry-exit';
import { parseSkillManifest } from '@core/notation/skill';
import { validateUnwalked } from '@runner/unwalked';
import type { Studyflow } from '@runner/studyflow';
import type { AnyNodeDefinition, LogFn, ValidationIssue } from '@runner/nodes/types';
import { findByFlowNode, getRegisteredNodes } from '@runner/nodes/registry';

// Auto-discovery: each `<kind>/index.tsx` here self-registers as a side effect of being imported.
import.meta.glob('./*/index.tsx', { eager: true });

// The skills' modules: whatever each `SKILL.md` names as `runtimes.browser`, imported so it registers itself the
// same way.
const manifests = import.meta.glob('@skills/*/SKILL.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const modules = import.meta.glob('@skills/*/**/*.tsx');

export const skillModulesLoaded: Promise<void> = (async () => {
  for (const [path, source] of Object.entries(manifests)) {
    const skill = parseSkillManifest(source, path.split('/').at(-2));
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

export async function validate(studyflow: Studyflow, log: LogFn): Promise<ValidationIssue[]> {
  await skillModulesLoaded;
  // The consent form a page fetches and the code it hands are what `studyflow validate` checks too.
  const entryExit = checkEntryExit(studyflow.model).map(({ elementId, severity, message }) => ({ nodeId: elementId, severity, message }));
  const issues: ValidationIssue[] = [...entryExit, ...validateUnwalked(studyflow)];

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
  }
  return issues;
}
