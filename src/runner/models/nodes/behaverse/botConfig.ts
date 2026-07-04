/**
 * Pure reads and transforms over a Behaverse task's `bot` configuration:
 * response-source discrimination, prompt extraction, effective LLM config
 * resolution, and payload sanitization for Unity. No I/O, no orchestration.
 */

import { RUNNER_ONLY_BOT_KEYS, type BehaverseBotPayload, type BehaverseTaskPayload } from '@/runner/models/nodes/behaverse/types';
import { getLLMSettings } from '@/core/settings';
import type { LLMProviderConfig } from '@/runner/models/nodes/behaverse/llm/types';

export function readResponseSource(bot: BehaverseTaskPayload['bot']): 'internal' | 'external' | 'llm' {
  if (!bot || typeof bot !== 'object') return 'internal';
  const value = (bot as Record<string, unknown>).ResponseSource;
  return value === 'external' || value === 'llm' ? value : 'internal';
}

export function readPrompt(bot: BehaverseTaskPayload['bot']): string {
  if (!bot || typeof bot !== 'object') return '';
  const value = (bot as Record<string, unknown>).Prompt;
  return typeof value === 'string' ? value : '';
}

/** Resolve effective LLM provider/model from per-task botConfigurations.LLM over global settings. */
export function resolveLLMConfig(bot: BehaverseTaskPayload['bot']): LLMProviderConfig {
  const settings = getLLMSettings();
  const override = (bot && typeof bot === 'object' ? (bot as Record<string, unknown>).LLM : undefined);
  const llmOverride = override && typeof override === 'object' && !Array.isArray(override)
    ? (override as Record<string, unknown>)
    : {};
  const provider = llmOverride.Provider === 'ollama' || llmOverride.Provider === 'claude'
    ? llmOverride.Provider
    : settings.provider;
  const model = typeof llmOverride.Model === 'string' && llmOverride.Model.length > 0
    ? llmOverride.Model
    : settings.model;
  return provider === 'claude'
    ? { provider, model, proxyUrl: settings.claudeProxyUrl }
    : { provider, model, url: settings.ollamaUrl };
}

/** Strip runner-only keys (e.g. `LLM`, `Prompt`) from the bot payload before
 *  sending to Unity; `BotReflection.Apply` throws on unknown field names.
 *  Also normalize `ResponseSource: llm` to `external`: Unity's per-game checks
 *  hardcode the string `"external"` to switch into runner-driven response mode,
 *  so `llm` (a runner-only discriminator) would silently fall back to internal. */
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
