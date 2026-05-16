import { getAttribute } from '@/lib/core/extensions';
import type { FlowNode } from '@/lib/core/flow';

/** Read a string moddle attribute off a node; undefined when missing or empty. */
export function readString(node: FlowNode, name: string): string | undefined {
  const value = getAttribute(node.businessObject, name);
  return typeof value === 'string' && value ? value : undefined;
}
