export type BehaverseBotPayload = Record<string, unknown>;

export const BEHAVERSE_TASK_TYPE = 'cognitive:BehaverseTask';

// Relative path so the iframe resolves under any Pages base; the Unity build lives inside the runner's /run/ prefix (deploy unpacks it into dist/run).
export const BEHAVERSE_RUNTIME_URL = './assessment-unity';

export function buildBehaverseIframeSrc(): string {
  return `${BEHAVERSE_RUNTIME_URL}/index.html?skipDebugMenu=1`;
}

/** Runner-only bot keys, stripped before Unity; `BotReflection.Apply` throws on unknown fields. */
export const RUNNER_ONLY_BOT_KEYS = ['LLM', 'Prompt', 'BridgeUrl'] as const;

/** `RunCognitiveTask` payload Unity receives as JSON; `parameters` layers over Resources/<scene>.json. */
export type BehaverseTaskPayload = {
  scene: string;
  timeline?: string;
  configMode: 'builtin' | 'inline';
  parameters?: Record<string, unknown>;
  agentType: 'human' | 'bot';
  bot?: BehaverseBotPayload;
  metadata: { studyflowNodeId: string };
  agent?: { id: string };
  /** BDM `study_id`. */
  studyId?: string;
  studyflowId?: string;
  sessionId?: string;
  studyflowHash?: string;
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
