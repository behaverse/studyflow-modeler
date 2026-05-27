/**
 * Bot payload shipped to Unity inside `RunTask`. Wire shape stays a free-form dict
 * so `BotReflection` can pick up new fields without a schema change.
 *
 * Field names are PascalCase to match the C# source-of-truth (BotReflection
 * applies them by name via reflection, so casing must match exactly).
 *
 * Documented fields (v1):
 * - `ResponseSource`: `'internal'` (default) uses Unity's in-game bot;
 *   `'external'` makes Unity emit `studyflow:AwaitingResponse` per trial and
 *   wait for an `InjectResponse` SendMessage from the runner.
 */
export type BehaverseBotPayload = Record<string, unknown>;

/** `RunTask` payload Unity receives as JSON; `builtin` uses a shipped timeline, `inline` layers `config` over Resources/<task>.json. */
export type BehaverseTaskPayload = {
  task: string;
  configMode: 'builtin' | 'inline';
  timeline?: string;
  config?: Record<string, unknown>;
  agentMode: 'human' | 'bot';
  bot?: BehaverseBotPayload;
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
