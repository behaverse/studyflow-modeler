// Naming contract:
//   FlowNode     — BPMN executable vertex (Task / Event / Gateway). Data, parsed from XML.
//   SequenceFlow — BPMN edge connecting two FlowNodes.
//   Process      — the parsed BPMN process: nodes + sequence flows + start id.
//   Job          — one materialized unit yielded by Graph.traverse() — the FlowNode
//                  plus per-kind extras the renderer needs. Derived from
//                  `JobsByKind` below, which each node module under
//                  src/runtime/nodes/<kind>/ augments to register its own job type.

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

export type Process = {
  businessObject: any;
  nodes: Map<string, FlowNode>;
  edges: Map<string, SequenceFlow>;
  startId?: string;
};

/**
 * Map of registered node kinds to their job types. Each node module under
 * src/runtime/nodes/<kind>/index.tsx augments this interface; the `Job` union
 * below is derived from it, so adding a new kind requires no edit here.
 *
 * In a node module:
 *   declare module '@/runtime/types' {
 *     interface JobsByKind { myKind: MyKindJob; }
 *   }
 */
export interface JobsByKind {}
export type Job = JobsByKind[keyof JobsByKind];
