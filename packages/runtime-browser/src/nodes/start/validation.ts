import { readString, type FlowNode } from '@runner/flow';
import type { ValidationIssue } from '@runner/nodes/types';

export function validateStartEvent(node: FlowNode): ValidationIssue[] {
  const consentFormUri = readString(node, 'consentFormUri') ?? '';
  if (consentFormUri && !/^(https?:|\/)/i.test(consentFormUri)) {
    return [{
      nodeId: node.id,
      message: `The consent form link '${consentFormUri}' is not a URL or an absolute path. `
        + 'Set consentFormUri to an https:// address or a path starting with "/".',
    }];
  }
  return [];
}
