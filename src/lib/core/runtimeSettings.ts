/** Runner-safe slice of user settings: provider + endpoint config for the
 *  LLM responder. Read/write via localStorage with a dedicated key so the
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
