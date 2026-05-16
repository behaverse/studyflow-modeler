/** BPMN flow primitives; see `@/runner/study` for the runtime wrapper. */
export type FlowNode = {
  id: string;
  type: string;
  extensionType?: string;
  businessObject: any;
  outgoing: string[];
  incoming: string[];
};

export type SequenceFlow = {
  id: string;
  sourceId: string;
  targetId: string;
  conditionExpression?: string;
  businessObject: any;
};
