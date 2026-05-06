/**
 * Wire payload for `RunTask`. Sent to Unity as a single
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
