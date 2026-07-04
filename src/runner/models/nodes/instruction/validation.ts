import type { FlowNode } from '@/runner/models/flow';
import type { ValidationIssue } from '@/runner/models/nodes/types';
import { readString } from '@/runner/models/nodes/readAttribute';

export function validateInstruction(node: FlowNode): ValidationIssue[] {
  const content = readString(node, 'content') ?? '';
  if (!content.trim()) {
    return [{ nodeId: node.id, message: `Instruction '${node.id}' has no content.` }];
  }
  return [];
}
