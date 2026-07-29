import type { FlowNode } from '@/runner/models/flow';
import type { NodeDefinition } from '@/runner/models/nodes/types';

// Standalone file so node modules can import `registerNode`, and so the
// session can resolve a node, without re-triggering the discovery glob in
// `./index.ts` (which is Vite-only and cannot load outside the bundler).

const nodes: NodeDefinition[] = [];

export function registerNode(def: NodeDefinition): void {
  if (nodes.some((n) => n.type === def.type)) {
    throw new Error(`Duplicate node type '${def.type}' registered.`);
  }
  nodes.push(def);
}

export function getRegisteredNodes(): readonly NodeDefinition[] {
  return nodes;
}

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
  const registered = getRegisteredNodes();

  for (const def of registered) {
    if ('extensionType' in def.match && node.extensionType === def.match.extensionType) {
      return def;
    }
  }
  for (const def of registered) {
    if ('bpmnType' in def.match) {
      const types = Array.isArray(def.match.bpmnType) ? def.match.bpmnType : [def.match.bpmnType];
      if (types.includes(node.type)) return def;
    }
  }
  if (BPMN_TASK_TYPES.has(node.type)) {
    return registered.find((d) => 'fallback' in d.match && d.match.fallback === 'task');
  }
  return undefined;
}
