import type { NodeDefinition } from './types';

const nodes: NodeDefinition[] = [];

/**
 * Register a runtime node. Each node module under src/runtime/nodes/<kind>/
 * calls this once at import time. The auto-discovery glob in ./index.ts
 * imports every such module, so adding a new node requires only creating a
 * new folder under nodes/<kind>/ with an index.tsx that calls registerNode.
 *
 * Lives in its own file (not index.ts) so each node module can import this
 * function without triggering the auto-discovery glob — that would create a
 * circular import where nodes are evaluated before `registerNode` is defined.
 */
export function registerNode(def: NodeDefinition): void {
  if (nodes.some((n) => n.kind === def.kind)) {
    throw new Error(`Duplicate node kind '${def.kind}' registered.`);
  }
  nodes.push(def);
}

export function getRegisteredNodes(): readonly NodeDefinition[] {
  return nodes;
}
