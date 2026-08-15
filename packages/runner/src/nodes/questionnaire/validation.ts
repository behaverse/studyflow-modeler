import { readString, type FlowNode } from '@runner/flow';
import type { ValidationIssue } from '@runner/nodes/types';
import { getInstrument, listInstrumentIds } from '@runner/nodes/questionnaire/instruments';

export function validateQuestionnaire(node: FlowNode): ValidationIssue[] {
  const instrument = readString(node, 'instrument') ?? '';
  if (!instrument.trim()) {
    return [{
      nodeId: node.id,
      message: 'This Questionnaire has no instrument, so it has no questions to ask. '
        + `Set instrument to ${listInstrumentIds().join(', ')}, or to any name for a free-text answer.`,
    }];
  }
  if (!getInstrument(instrument)) {
    return [{
      nodeId: node.id,
      severity: 'warning',
      message: `The runner has no item set for instrument '${instrument}', so participants will answer in their own words. `
        + `Built in: ${listInstrumentIds().join(', ')}.`,
    }];
  }
  return [];
}
