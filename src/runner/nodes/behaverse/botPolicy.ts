/**
 * Bot response policy: given a Unity `AwaitingResponse` trial, decide what to
 * answer and how to attribute it. Owns the `botConfigurations` reading
 * (ResponseSource / Prompt / LLM overrides) and the LLM-vs-random dispatch;
 * the Unity wiring lives in `bridge.ts`.
 */

import { RUNNER_ONLY_BOT_KEYS, type BehaverseBotPayload, type BehaverseTaskPayload } from '@/runner/nodes/behaverse/types';
import { getLLMSettings } from '@/lib/core/runnerSettings';
import { selectResponse } from '@/runner/nodes/behaverse/llm/bot';
import type { LLMProviderConfig, TrialHistoryEntry } from '@/runner/nodes/behaverse/llm/types';
import type { AwaitingResponseDetail } from './unityTopics';
import type { LogKind } from '../../styles';

export type LogFn = (kind: LogKind, message: string) => void;

/** A decided trial response plus the agent id to attribute it to
 *  (`<provider>:<model>` when an LLM answered, `bot` otherwise). */
export type BotDecision = { response: string; agentId: string };

export function readResponseSource(bot: BehaverseTaskPayload['bot']): 'internal' | 'external' | 'llm' {
  if (!bot || typeof bot !== 'object') return 'internal';
  const value = (bot as Record<string, unknown>).ResponseSource;
  return value === 'external' || value === 'llm' ? value : 'internal';
}

function readPrompt(bot: BehaverseTaskPayload['bot']): string {
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
  return {
    provider,
    model,
    ollamaUrl: settings.ollamaUrl,
    claudeProxyUrl: settings.claudeProxyUrl,
  };
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

/** Decide the response for one trial: ask the LLM when `ResponseSource: llm`
 *  (falling back to random on error), pick uniformly at random otherwise. */
export async function decideResponse(
  payload: BehaverseTaskPayload,
  detail: AwaitingResponseDetail,
  history: TrialHistoryEntry[],
  log?: LogFn,
): Promise<BotDecision> {
  if (readResponseSource(payload.bot) === 'llm') {
    const llmConfig = resolveLLMConfig(payload.bot);
    log?.('task', `[${llmConfig.provider}:${llmConfig.model}] trial ${detail.TrialIndex}: querying...`);
    const result = await selectResponse({
      taskId: payload.scene,
      taskConfig: payload.parameters,
      prompt: readPrompt(payload.bot),
      stimulus: detail.Stimulus,
      responseOptions: detail.ResponseOptions,
      trialIndex: detail.TrialIndex,
      history,
      ...(typeof detail.Screenshot === 'string' && detail.Screenshot.length > 0
        ? { screenshot: detail.Screenshot }
        : {}),
    }, llmConfig);
    if (result.source === 'llm') {
      log?.('info', `[${llmConfig.provider}:${llmConfig.model}] trial ${detail.TrialIndex} -> "${result.response}"`);
    } else if (result.error) {
      log?.('error', `[${llmConfig.provider}:${llmConfig.model}] trial ${detail.TrialIndex} -> fall back to random "${result.response}": ${result.error}`);
      console.warn(`[behaverse:llm] trial ${detail.TrialIndex} fell back to random: ${result.error}`);
    }
    // When the LLM actually answered, tag the response with `<provider>:<model>`
    // so downstream telemetry can distinguish LLM-driven from random-fallback
    // trials. On random fallback, keep the generic `bot` tag.
    const agentId = result.source === 'llm' ? `${llmConfig.provider}:${llmConfig.model}` : 'bot';
    return { response: result.response, agentId };
  }

  const response = detail.ResponseOptions[Math.floor(Math.random() * detail.ResponseOptions.length)];
  return { response, agentId: 'bot' };
}
