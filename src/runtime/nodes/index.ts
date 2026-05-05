import type { FlowNode, Process } from '../types';
import type { Manifest, ValidationIssue } from './behaverse/types';
import type { NodeDefinition } from './types';
import { getRegisteredNodes } from './registry';

// Auto-discover every node module. Vite resolves the glob at build time and
// eager-imports each one, triggering its registerNode() side effect.
//
// Each node module imports `registerNode` from './registry' (not from here)
// to avoid a circular import — see registry.ts for details.
import.meta.glob('./*/index.tsx', { eager: true });

export { registerNode } from './registry';

// bpmn:*Task subtypes that the fallback node catches when no appliedType matches.
const BPMN_TASK_TYPES = new Set([
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:ManualTask',
]);

/**
 * Find the node definition responsible for a given FlowNode. Three-pass match:
 *   1. appliedType — most specific (studyflow:Instruction, behaverse:BehaverseTask, …)
 *   2. bpmnType    — less specific (bpmn:StartEvent, bpmn:EndEvent)
 *   3. fallback    — catch-all for unmatched bpmn:*Task nodes
 * Returns undefined for gateways and other unsupported nodes (graph traversal
 * skips those).
 */
export function findByFlowNode(node: FlowNode): NodeDefinition | undefined {
  const nodes = getRegisteredNodes();
  for (const def of nodes) {
    if ('appliedType' in def.match && node.appliedType === def.match.appliedType) {
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
export function validate(process: Process, manifest?: Manifest): ValidationIssue[] {
  return getRegisteredNodes().flatMap((n) => n.validate?.(process, manifest) ?? []);
}

/**
 * True when at least one node in the process applies the Behaverse type.
 * The executor uses this to decide whether to fetch the Unity manifest
 * (which fails if the Unity build isn't deployed).
 */
export function requiresBehaverseRuntime(process: Process): boolean {
  for (const node of process.nodes.values()) {
    if (node.appliedType === 'behaverse:BehaverseTask') return true;
  }
  return false;
}

export { fetchManifest, BEHAVERSE_RUNTIME_URL } from './behaverse';
