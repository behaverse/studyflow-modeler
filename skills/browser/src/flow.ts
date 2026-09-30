import { getAttribute } from '@core/element';

export type FlowNode = {
  id: string;
  type: string;
  extensionType?: string;
  businessObject: any;
  /** What the step reads: the `studyflow:Parameters` wired into it, merged; empty when none is. */
  parameters: Record<string, unknown>;
  outgoing: string[];
  incoming: string[];
};

export type SequenceFlow = {
  id: string;
  sourceId: string;
  targetId: string;
  businessObject: any;
};

export function readString(node: FlowNode, name: string): string | undefined {
  const value = getAttribute(node.businessObject, name);
  return typeof value === 'string' && value ? value : undefined;
}
