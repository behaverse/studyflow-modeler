import { BPMN } from '@behaverse/studyflow-core/constants';
import type { FlowNode } from '@/runner/flow';
import type { Job } from '@/runner/jobs';
import type { AnyNodeDefinition, NodeDefinition } from '@/runner/nodes/types';

// Standalone so node modules and the session avoid the discovery glob in `./index.ts` (Vite-only).

const nodes: AnyNodeDefinition[] = [];

export function registerNode<J extends Job>(def: NodeDefinition<J>): void {
  if (nodes.some((n) => n.type === def.type)) {
    throw new Error(`Duplicate node type '${def.type}' registered.`);
  }
  nodes.push(def);
}

export function getRegisteredNodes(): readonly AnyNodeDefinition[] {
  return nodes;
}

/** What `{ fallback: 'task' }` catches: any task the more specific matchers left unclaimed. */
const BPMN_TASK_TYPES: ReadonlySet<string> = new Set<string>([
  BPMN.Task,
  BPMN.UserTask,
  BPMN.ServiceTask,
  BPMN.ScriptTask,
  BPMN.ManualTask,
]);

export function findByFlowNode(node: FlowNode): AnyNodeDefinition | undefined {
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
