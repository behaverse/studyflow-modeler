import { BPMN } from '@core/constants';
import type { FlowNode } from '@runner/flow';
import type { Job } from '@runner/jobs';
import type { AnyNodeDefinition, NodeDefinition } from '@runner/nodes/types';

// Standalone so node modules and the session avoid the discovery glob in `./index.ts` (Vite-only).

const nodes: AnyNodeDefinition[] = [];

export function registerNode<J extends Job, C = unknown>(def: NodeDefinition<J, C>): void {
  if (nodes.some((n) => n.type === def.type)) {
    throw new Error(`Duplicate node type '${def.type}' registered.`);
  }
  nodes.push(def);
}

export function getRegisteredNodes(): readonly AnyNodeDefinition[] {
  return nodes;
}

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
  // `{ fallback: 'task' }` catches any task (a `bpmn:Task` subtype) the more specific matchers left unclaimed.
  if (node.businessObject?.$instanceOf?.(BPMN.Task)) {
    return registered.find((d) => 'fallback' in d.match && d.match.fallback === 'task');
  }
  return undefined;
}
