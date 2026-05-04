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

/**
 * Wire payload for `RunTaskActivity`. Sent to Unity as a single
 * JSON.stringify'd argument. The two `configMode` branches are mutually
 * exclusive on the diagram side: `builtin` carries `timeline` (a string
 * referencing a build-shipped timeline); `inline` carries `config` (the full
 * `GameConfig` parsed from the YAML body to a JSON object). `bot` is
 * undefined when `agentMode` is `human` or the YAML body is empty.
 */
export type BehaverseTaskPayload = {
  task: string;
  configMode: 'builtin' | 'inline';
  timeline?: string;
  config?: Record<string, unknown>;
  agentMode: 'human' | 'bot';
  bot?: Record<string, unknown>;
  metadata: { studyflowNodeId: string };
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
