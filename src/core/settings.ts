/** Runner-safe slice of user settings: provider + endpoint config for the
 *  LLM bot. Read/write via localStorage with a dedicated key so the
 *  modeler-side settings store and the runner can both consume it. */

const LLM_STORAGE_KEY = 'studyflow-modeler:llm:v1';

export type LLMProvider = 'claude' | 'ollama';

export type LLMRuntimeSettings = {
  provider: LLMProvider;
  model: string;
  ollamaUrl: string;
  claudeProxyUrl: string;
};

const DEFAULTS: LLMRuntimeSettings = {
  provider: 'claude',
  model: 'claude-haiku-4-5',
  ollamaUrl: 'http://localhost:11434',
  claudeProxyUrl: '/api/llm/claude',
};

/** localStorage get that survives SSR, privacy mode, and quota errors. */
function lsGet(key: string): string | undefined {
  try { return window.localStorage.getItem(key) ?? undefined; } catch { return undefined; }
}

function lsSet(key: string, value: string | undefined): void {
  try {
    if (value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* quota / privacy mode */ }
}

export function getLLMSettings(): LLMRuntimeSettings {
  const raw = lsGet(LLM_STORAGE_KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<LLMRuntimeSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export const API_KEY_STORAGE_KEY = 'studyflow-modeler:api_key:v1';

export function getApiKey(): string | undefined {
  const key = lsGet(API_KEY_STORAGE_KEY);
  return key && key !== 'guest' ? key : undefined;
}

export const RECORD_EVENTS_STORAGE_KEY = 'studyflow-modeler:should_record_events:v1';

/** Whether the runner should record this run's data (session, variables, and
 *  Unity events) to the data-server. Off unless the user opts in via the
 *  runner's "Record events" toggle. Stored under its own key so the choice
 *  sticks across runs without being passed as a URL param. */
export function shouldRecordEvents(): boolean {
  return lsGet(RECORD_EVENTS_STORAGE_KEY) === '1';
}

export function setRecordEvents(enabled: boolean): void {
  lsSet(RECORD_EVENTS_STORAGE_KEY, enabled ? '1' : undefined);
}
