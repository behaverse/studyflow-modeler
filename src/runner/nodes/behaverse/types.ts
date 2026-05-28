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
 *   wait for an `InjectResponse` SendMessage from the runner - the runner's
 *   built-in policy picks uniformly at random from `ResponseOptions`;
 *   `'llm'` is like `'external'` but the runner asks an LLM (`claude` or
 *   `ollama`) to choose. Unity-side fields below are inert for `'llm'`.
 * - `LLM`: `{ Provider, Model }` - overrides the global LLM defaults for this
 *   task only. Provider must be `'claude'` or `'ollama'`. Both subfields
 *   optional; missing values fall back to global settings.
 * - `Prompt`: free-form string used as the LLM's system prompt. Persona,
 *   target accuracy, strategy, mistakes to make - anything that should steer
 *   the simulated participant goes here. The runner appends task config,
 *   trial history, current stimulus, and response options as the user
 *   message; the LLM's reply is matched against `ResponseOptions`.
 * - `IncludeScreenshot`: opt-in boolean (default `false`). When `true` and
 *   `ResponseSource: llm`, Unity captures the current frame at each
 *   `AwaitingResponse` and embeds it as a `data:image/png;base64,...` URL on
 *   the event payload (`Screenshot` field). The runner attaches it as an
 *   image content block to the LLM call so vision-capable models (Claude
 *   Haiku/Sonnet, Ollama `llava`/`llama3.2-vision`) can see the actual
 *   stimulus - essential for visual tasks like WhichOne, PatternComparison,
 *   UFOV. Capturing the screen costs a synchronous readback; only enable
 *   when needed.
 *
 * Note: Unity has no infinite-wait flag today (see GameManager.AwaitExternal-
 * ResponseAsync). Bump `MaxResponseTime` in the inline `configurations` YAML
 * to give the LLM time to reply.
 */
export type BehaverseBotPayload = Record<string, unknown>;

/** Keys in `botConfigurations` YAML that are consumed by the studyflow runner and must
 *  NOT be forwarded to Unity's `BotReflection.Apply` - that helper throws on
 *  any unknown field name. The validator also exempts these from the flat-scalar
 *  check, since they may carry nested objects (e.g. `LLM: { Provider, Model }`). */
export const RUNNER_ONLY_BOT_KEYS = ['LLM', 'Prompt'] as const;

/** `RunTask` payload Unity receives as JSON; `builtin` uses a shipped timeline, `inline` layers `config` over Resources/<task>.json. */
export type BehaverseTaskPayload = {
  task: string;
  configMode: 'builtin' | 'inline';
  timeline?: string;
  config?: Record<string, unknown>;
  agentType: 'human' | 'bot';
  bot?: BehaverseBotPayload;
  metadata: { studyflowNodeId: string };
  /** Participant identity. Stamped onto every Unity telemetry event as
   *  `agent.id`; maps to BDM `agent_id`. Omitted ⇒ Unity falls back to its
   *  per-device PlayerPrefs GUID (dev/solo mode). */
  agent?: { id: string };
  /** BDM `study_id`. Sourced from the BPMN root element's `id` attribute. */
  studyId?: string;
  /** Identifier for the specific studyflow document. Sourced from the BPMN
   *  root element's `name` (matches the modeler navbar). */
  studyflowId?: string;
  /** Runner-session identifier; stamped into `context.session`. */
  sessionId?: string;
  /** SHA-256 hex of the studyflow XML. Stamped into `context.studyflowHash`
   *  so events can be pinned to the exact source document. */
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
