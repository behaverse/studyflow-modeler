/** `RunTask` payload Unity receives as JSON; `builtin` uses a shipped timeline, `inline` layers `config` over Resources/<task>.json. */
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
