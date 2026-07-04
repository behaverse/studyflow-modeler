import type { FlowNode } from '@/runner/models/flow';
import type { ValidationIssue } from '@/runner/models/nodes/types';
import { readString } from '@/runner/models/nodes/readAttribute';

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
