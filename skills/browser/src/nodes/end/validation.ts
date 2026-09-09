import { readString, type FlowNode } from '@runner/flow';
import type { ValidationIssue } from '@runner/nodes/types';
import { readCompletionCodeType } from '@runner/nodes/end/completionCode';

export function validateEndEvent(node: FlowNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const redirectTo = readString(node, 'redirectTo') ?? '';
  const completionCodeType = readCompletionCodeType(node);
  const completionCode = readString(node, 'completionCode') ?? '';

  if (completionCodeType === 'static' && !completionCode) {
    issues.push({
      nodeId: node.id,
      message: "completionCodeType is 'static' but completionCode is empty, so participants would get no code. "
        + "Type the code in completionCode, or switch completionCodeType to 'dynamic'.",
    });
  }
  if (redirectTo.includes('{COMPLETION_CODE}') && completionCodeType === 'none') {
    issues.push({
      nodeId: node.id,
      message: "redirectTo contains {COMPLETION_CODE} but completionCodeType is 'none', so the link would carry a blank code. "
        + "Set completionCodeType to 'static' or 'dynamic', or drop the placeholder.",
    });
  }
  return issues;
}
