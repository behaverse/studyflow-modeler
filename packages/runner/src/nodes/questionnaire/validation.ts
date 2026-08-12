import { readString, type FlowNode } from '@runner/flow';
import type { ValidationIssue } from '@runner/nodes/types';

export function validateQuestionnaire(node: FlowNode): ValidationIssue[] {
  const instrument = readString(node, 'instrument') ?? '';
  if (!instrument.trim()) {
    return [{ nodeId: node.id, message: `Questionnaire '${node.id}' has no instrument set.` }];
  }
  return [];
}
