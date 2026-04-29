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

export type RuntimeStep =
  | { kind: 'start'; node: RuntimeNode }
  | { kind: 'task'; node: RuntimeNode; payload: BehaverseTaskPayload }
  | { kind: 'instruction'; node: RuntimeNode; content: string }
  | { kind: 'questionnaire'; node: RuntimeNode; instrument?: string }
  | { kind: 'end'; node: RuntimeNode };

export type BehaverseTaskPayload = {
  task: string;
  timeline?: string;
  configMode: 'builtin' | 'inline';
  overrides?: Record<string, unknown>;
  inlineConfig?: string;
};

export type ManifestTask = {
  id: string;
  scene?: string;
  timelines: string[];
};

export type Manifest = {
  version: number;
  tasks: ManifestTask[];
};

export type ValidationIssue = {
  nodeId: string;
  taskId?: string;
  timelineId?: string;
  message: string;
};
