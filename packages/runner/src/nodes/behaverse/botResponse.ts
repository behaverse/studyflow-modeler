import type { BehaverseTaskPayload } from '@runner/nodes/behaverse/types';
import { readResponseSource, readPrompt, resolveLLMConfig } from '@runner/nodes/behaverse/botConfig';
import { selectResponse } from '@runner/nodes/behaverse/llm/bot';
import type { TrialHistoryEntry } from '@runner/nodes/behaverse/llm/types';
import type { AwaitingResponseDetail } from '@runner/nodes/behaverse/unityTopics';
import type { LogFn } from '@runner/nodes/types';

export type BotDecision = { response: string; agentId: string };

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
    // Tag LLM-answered trials `<provider>:<model>` so telemetry can distinguish them from random fallback.
    const agentId = result.source === 'llm' ? `${llmConfig.provider}:${llmConfig.model}` : 'bot';
    return { response: result.response, agentId };
  }

  const response = detail.ResponseOptions[Math.floor(Math.random() * detail.ResponseOptions.length)];
  return { response, agentId: 'bot' };
}
