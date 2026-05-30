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

function ls(): Storage | undefined {
  return typeof window !== 'undefined' ? window.localStorage : undefined;
}

export function getLLMSettings(): LLMRuntimeSettings {
  const raw = (() => {
    try { return ls()?.getItem(LLM_STORAGE_KEY) ?? undefined; } catch { return undefined; }
  })();
  if (!raw) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<LLMRuntimeSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setLLMSettings(partial: Partial<LLMRuntimeSettings>): LLMRuntimeSettings {
  const next = { ...getLLMSettings(), ...partial };
  try { ls()?.setItem(LLM_STORAGE_KEY, JSON.stringify(next)); } catch { /* quota / privacy mode */ }
  return next;
}

export const API_KEY_STORAGE_KEY = 'studyflow-modeler:api_key:v1';

export function getApiKey(): string | undefined {
  try {
    const key = ls()?.getItem(API_KEY_STORAGE_KEY) ?? undefined;
    return key && key !== 'guest' ? key : undefined;
  } catch {
    return undefined;
  }
}

export const RECORD_EVENTS_STORAGE_KEY = 'studyflow-modeler:should_record_events:v1';

/** Whether the runner should record this run's data (session, variables, and
 *  Unity events) to the data-server. Off unless the user opts in via the
 *  runner's "Record events" toggle. Stored under its own key so the choice
 *  sticks across runs without being passed as a URL param. */
export function shouldRecordEvents(): boolean {
  try {
    return ls()?.getItem(RECORD_EVENTS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setRecordEvents(enabled: boolean): void {
  try {
    if (enabled) ls()?.setItem(RECORD_EVENTS_STORAGE_KEY, '1');
    else ls()?.removeItem(RECORD_EVENTS_STORAGE_KEY);
  } catch { /* quota / privacy mode */ }
}
