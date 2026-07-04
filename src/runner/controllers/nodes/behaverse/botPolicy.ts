/**
 * Bot response policy: given a Unity `AwaitingResponse` trial, decide what to
 * answer and how to attribute it. Owns the `botConfigurations` reading
 * (ResponseSource / Prompt / LLM overrides) and the LLM-vs-random dispatch;
 * the Unity wiring lives in `bridge.ts`.
 */

import type { BehaverseTaskPayload } from '@/runner/models/nodes/behaverse/types';
import { readResponseSource, readPrompt, resolveLLMConfig } from '@/runner/models/nodes/behaverse/botConfig';
import { selectResponse } from '@/runner/infra/nodes/behaverse/llm/bot';
import type { TrialHistoryEntry } from '@/runner/models/nodes/behaverse/llm/types';
import type { AwaitingResponseDetail } from '@/runner/models/nodes/behaverse/unityTopics';
import type { LogKind } from '@/runner/models/log';

export type LogFn = (kind: LogKind, message: string) => void;

/** A decided trial response plus the agent id to attribute it to
 *  (`<provider>:<model>` when an LLM answered, `bot` otherwise). */
export type BotDecision = { response: string; agentId: string };

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
