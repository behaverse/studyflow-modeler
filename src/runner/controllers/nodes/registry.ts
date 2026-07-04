import type { NodeDefinition } from '@/runner/models/nodes/types';

// Standalone file so node modules can import `registerNode` without re-triggering the discovery glob.

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
