import { getAttribute } from '@/core/element';

export type FlowNode = {
  id: string;
  type: string;
  extensionType?: string;
  businessObject: any;
  outgoing: string[];
  incoming: string[];
  scopeId: string;
};

export type SequenceFlow = {
  id: string;
  sourceId: string;
  targetId: string;
  conditionExpression?: string;
  /** BPMN's per-expression `language`; unset means JavaScript in this runner. */
  conditionLanguage?: string;
  businessObject: any;
};

export function readString(node: FlowNode, name: string): string | undefined {
  const value = getAttribute(node.businessObject, name);
  return typeof value === 'string' && value ? value : undefined;
}
