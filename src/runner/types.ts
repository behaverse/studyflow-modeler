// Generic studyflow graph types — independent of any element-specific runner.
// Per-element payload types (e.g. BehaverseTaskPayload) live alongside their
// runner under src/runner/<element>/types.ts.

export type RuntimeNode = {
  id: string;
  type: string;
  appliedType?: string;
  businessObject: any;
  outgoing: string[];
  incoming: string[];
};

export type RuntimeEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  conditionExpression?: string;
  businessObject: any;
};

export type RuntimeGraph = {
  process: any;
  nodes: Map<string, RuntimeNode>;
  edges: Map<string, RuntimeEdge>;
  startId?: string;
};

import type { BehaverseTaskPayload } from './behaverse/types';

export type RuntimeStep =
  | { kind: 'start'; node: RuntimeNode }
  | { kind: 'task'; node: RuntimeNode; payload: BehaverseTaskPayload }
  | { kind: 'instruction'; node: RuntimeNode; content: string }
  | { kind: 'questionnaire'; node: RuntimeNode; instrument?: string }
  | { kind: 'end'; node: RuntimeNode };
