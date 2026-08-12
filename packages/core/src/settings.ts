import { STORAGE_KEYS, jsonCodec, persisted, stringCodec } from '@behaverse/studyflow-core/storage';

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

const llmStore = persisted<Partial<LLMRuntimeSettings>>(
  STORAGE_KEYS.llm,
  jsonCodec<Partial<LLMRuntimeSettings>>(),
  {},
);

export function getLLMSettings(): LLMRuntimeSettings {
  return { ...DEFAULTS, ...llmStore.load() };
}

const apiKeyStore = persisted<string>(STORAGE_KEYS.apiKey, stringCodec, '');

export function getApiKey(): string | undefined {
  const key = apiKeyStore.peek();
  // 'guest' is the Account section's "continue without a key" marker, stored to stop the sign-in prompt — not a key.
  return key && key !== 'guest' ? key : undefined;
}

const recordEventsStore = persisted<string>(STORAGE_KEYS.recordEvents, stringCodec, '');

export function shouldRecordEvents(): boolean {
  return recordEventsStore.peek() === '1';
}

export function setRecordEvents(enabled: boolean): void {
  if (enabled) recordEventsStore.save('1');
  else recordEventsStore.clear();
}
