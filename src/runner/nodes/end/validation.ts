import { readString, type FlowNode } from '@/runner/flow';
import type { ValidationIssue } from '@/runner/nodes/types';
import { readCompletionCodeType } from '@/runner/nodes/end/completionCode';

export function validateEndEvent(node: FlowNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const redirectTo = readString(node, 'redirectTo') ?? '';
  const completionCodeType = readCompletionCodeType(node);
  const completionCode = readString(node, 'completionCode') ?? '';

  if (completionCodeType === 'static' && !completionCode) {
    issues.push({
      nodeId: node.id,
      message: `EndEvent '${node.id}' uses static completionCode but no completionCode value is set.`,
    });
  }
  if (redirectTo.includes('{COMPLETION_CODE}') && completionCodeType === 'none') {
    issues.push({
      nodeId: node.id,
      message: `EndEvent '${node.id}': redirectTo references {COMPLETION_CODE} but completionCodeType is 'none'.`,
    });
  }
  return issues;
}
