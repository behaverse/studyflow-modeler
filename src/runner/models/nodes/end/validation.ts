import type { FlowNode } from '@/runner/models/flow';
import type { ValidationIssue } from '@/runner/models/nodes/types';
import { readString } from '@/runner/models/nodes/readAttribute';
import { readCompletionCodeType } from '@/runner/models/nodes/end/completionCode';

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
