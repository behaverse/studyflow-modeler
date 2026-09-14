import { RUNNER_ONLY_BOT_KEYS, type BehaverseBotPayload, type BehaverseTaskPayload } from '@skills/behaverse/browser/types';
import type { LLMProviderConfig } from '@skills/behaverse/browser/llm/types';

export function readResponseSource(bot: BehaverseTaskPayload['bot']): 'internal' | 'llm' {
  return bot && typeof bot === 'object' && (bot as Record<string, unknown>).ResponseSource === 'llm' ? 'llm' : 'internal';
}

export function readPrompt(bot: BehaverseTaskPayload['bot']): string {
  if (!bot || typeof bot !== 'object') return '';
  const value = (bot as Record<string, unknown>).Prompt;
  return typeof value === 'string' ? value : '';
}

const OLLAMA_URL = 'http://localhost:11434';
const CLAUDE_PROXY_URL = '/api/llm/claude';

/** The model the task's band names, as the parser put it in `bot.LLM`. */
export function resolveLLMConfig(bot: BehaverseTaskPayload['bot']): LLMProviderConfig {
  const llm = (bot as Record<string, unknown> | undefined)?.LLM as { Provider?: unknown; Model?: unknown } | undefined;
  const model = typeof llm?.Model === 'string' ? llm.Model : '';
  if (llm?.Provider === 'claude' && model) return { provider: 'claude', model, proxyUrl: CLAUDE_PROXY_URL };
  if (llm?.Provider === 'ollama' && model) return { provider: 'ollama', model, url: OLLAMA_URL };
  throw new Error('The task\'s bot names no model: its band\'s actor sets one with its implementation.');
}

export function botForUnity(bot: BehaverseBotPayload | undefined): BehaverseBotPayload | undefined {
  if (!bot) return undefined;
  const runnerOnly = new Set<string>(RUNNER_ONLY_BOT_KEYS);
  const stripped: BehaverseBotPayload = {};
  for (const [k, v] of Object.entries(bot)) {
    if (runnerOnly.has(k)) continue;
    stripped[k] = k === 'ResponseSource' && v === 'llm' ? 'external' : v;
  }
  return Object.keys(stripped).length > 0 ? stripped : undefined;
}
