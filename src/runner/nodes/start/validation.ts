import { readString, type FlowNode } from '@/runner/flow';
import type { ValidationIssue } from '@/runner/nodes/types';

export function validateStartEvent(node: FlowNode): ValidationIssue[] {
  const consentFormUri = readString(node, 'consentFormUri') ?? '';
  if (consentFormUri && !/^(https?:|\/)/i.test(consentFormUri)) {
    return [{
      nodeId: node.id,
      message: `consentFormUri '${consentFormUri}' does not look like a URL or absolute path.`,
    }];
  }
  return [];
}
