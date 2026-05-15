import type { FlowNode } from '@/lib/core/flow';
import type { Study } from '@/runner/study';
import type { Manifest, ValidationIssue } from './behaverse/types';
import type { NodeDefinition } from '@/runner/nodes/types';
import { getRegisteredNodes } from './registry';

// Auto-discover every node module. Vite resolves the glob at build time and
// eager-imports each one, triggering its registerNode() side effect.
//
// Each node module imports `registerNode` from './registry' (not from here)
// to avoid a circular import - see registry.ts for details.
import.meta.glob('./*/index.tsx', { eager: true });

export { registerNode } from './registry';

// bpmn:*Task subtypes that the fallback node catches when no extensionType matches.
const BPMN_TASK_TYPES = new Set([
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:ManualTask',
]);

/**
 * Find the node definition responsible for a given FlowNode. Three-pass match:
 *   1. extensionType - most specific (cognitive:Instruction, behaverse:BehaverseTask, …)
 *   2. bpmnType      - less specific (bpmn:StartEvent, bpmn:EndEvent)
 *   3. fallback    - catch-all for unmatched bpmn:*Task nodes
 * Returns undefined for gateways and other unsupported nodes (graph traversal
 * skips those).
 */
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
    for (const def of nodes) {
      if ('fallback' in def.match && def.match.fallback === 'task') return def;
    }
  }
  return undefined;
}

export function findByKind(kind: string): NodeDefinition | undefined {
  return getRegisteredNodes().find((n) => n.kind === kind);
}

/**
 * Aggregate validation across every registered node.
 */
export function validate(study: Study, manifest?: Manifest): ValidationIssue[] {
  return getRegisteredNodes().flatMap((n) => n.validate?.(study, manifest) ?? []);
}

/**
 * True when at least one node in the study applies the Behaverse type.
 * The executor uses this to decide whether to fetch the Unity manifest
 * (which fails if the Unity build isn't deployed).
 */
export function requiresBehaverseRuntime(study: Study): boolean {
  for (const node of study.nodes.values()) {
    if (node.extensionType === 'behaverse:BehaverseTask') return true;
  }
  return false;
}

export { fetchManifest, BEHAVERSE_RUNTIME_URL } from './behaverse';
