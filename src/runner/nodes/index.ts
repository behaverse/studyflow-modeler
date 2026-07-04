import type { FlowNode } from '@/lib/core/flow';
import type { Studyflow } from '@/runner/studyflow';
import type { Manifest } from './behaverse/types';
import type { NodeDefinition, ValidationIssue } from './types';
import { getRegisteredNodes } from './registry';

// Auto-discover node modules; each calls `registerNode` as a side effect.
import.meta.glob('./*/index.tsx', { eager: true });

export { registerNode } from './registry';

/** bpmn:*Task subtypes claimed by the fallback node when no extensionType matches. */
const BPMN_TASK_TYPES = new Set([
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:ManualTask',
]);

/** Precedence: extensionType -> bpmnType -> fallback; undefined for unsupported nodes (skipped). */
export function findByFlowNode(node: FlowNode): NodeDefinition | undefined {
  const nodes = getRegisteredNodes();

  for (const def of nodes) {
    if ('extensionType' in def.match && node.extensionType === def.match.extensionType) {
      return def;
    }
  }
  for (const def of nodes) {
    if ('bpmnType' in def.match) {
      const types = Array.isArray(def.match.bpmnType) ? def.match.bpmnType : [def.match.bpmnType];
      if (types.includes(node.type)) return def;
    }
  }
  if (BPMN_TASK_TYPES.has(node.type)) {
    return nodes.find((d) => 'fallback' in d.match && d.match.fallback === 'task');
  }
  return undefined;
}

export function findByType(type: string): NodeDefinition | undefined {
  return getRegisteredNodes().find((n) => n.type === type);
}

export function validate(studyflow: Studyflow, manifest?: Manifest): ValidationIssue[] {
  const issues = getRegisteredNodes().flatMap((n) => n.validate?.(studyflow, manifest) ?? []);
  for (const node of studyflow.flowNodes.values()) {
    const def = findByFlowNode(node);
    if (def?.validateNode) issues.push(...def.validateNode(node, studyflow, manifest));
  }
  return issues;
}

/** Drives whether the runner pre-fetches the Unity manifest. */
export function requiresBehaverseRuntime(studyflow: Studyflow): boolean {
  for (const node of studyflow.flowNodes.values()) {
    if (findByFlowNode(node)?.type === 'behaverse') return true;
  }
  return false;
}

export { BEHAVERSE_RUNTIME_URL } from './behaverse/iframe';
export { fetchManifest } from './behaverse/validator';
