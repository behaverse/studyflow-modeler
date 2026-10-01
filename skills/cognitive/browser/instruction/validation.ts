import { readString, type FlowNode } from '@runner/flow';
import type { ValidationIssue } from '@runner/nodes/types';

export function validateInstruction(node: FlowNode): ValidationIssue[] {
  const content = readString(node, 'content') ?? '';
  if (!content.trim()) {
    return [{
      nodeId: node.id,
      message: 'This Instruction has no content, so the participant would face an empty screen. '
        + 'Write what they should read in the content field.',
    }];
  }
  return [];
}
