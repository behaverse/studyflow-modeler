import { readString, type FlowNode } from '@/runner/flow';
import type { ValidationIssue } from '@/runner/nodes/types';

export function validateInstruction(node: FlowNode): ValidationIssue[] {
  const content = readString(node, 'content') ?? '';
  if (!content.trim()) {
    return [{ nodeId: node.id, message: `Instruction '${node.id}' has no content.` }];
  }
  return [];
}
