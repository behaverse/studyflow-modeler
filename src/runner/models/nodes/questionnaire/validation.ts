import type { FlowNode } from '@/runner/models/flow';
import type { ValidationIssue } from '@/runner/models/nodes/types';
import { readString } from '@/runner/models/nodes/readAttribute';

export function validateQuestionnaire(node: FlowNode): ValidationIssue[] {
  const instrument = readString(node, 'instrument') ?? '';
  if (!instrument.trim()) {
    return [{ nodeId: node.id, message: `Questionnaire '${node.id}' has no instrument set.` }];
  }
  return [];
}
