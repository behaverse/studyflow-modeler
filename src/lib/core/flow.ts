// BPMN flow primitives. The materialized `Study` (data + runtime engine)
// lives in @/runner/study — see it for the parsed graph wrapper.

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
