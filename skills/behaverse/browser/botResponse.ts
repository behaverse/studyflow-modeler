import type { BehaverseTaskPayload } from '@skills/behaverse/browser/types';
import { readResponseSource, readPrompt, resolveLLMConfig } from '@skills/behaverse/browser/botConfig';
import { selectResponse } from '@skills/behaverse/browser/llm/bot';
import type { TrialHistoryEntry } from '@skills/behaverse/browser/llm/types';
import type { AwaitingResponseDetail } from '@skills/behaverse/browser/unityTopics';
import type { LogFn } from '@runner/nodes/types';

export type BotDecision = { response: string; agentId: string };

/** The model on the task's band answers the trial. A failed call, or a reply naming no option, answers nothing: the
 * trial's own response window then ends it, a miss. */
export async function decideResponse(
  payload: BehaverseTaskPayload,
  detail: AwaitingResponseDetail,
  history: TrialHistoryEntry[],
  log?: LogFn,
): Promise<BotDecision | undefined> {
  if (readResponseSource(payload.bot) !== 'llm') return undefined;
  const llmConfig = resolveLLMConfig(payload.bot);
  const agentId = `${llmConfig.provider}:${llmConfig.model}`;
  log?.('task', `[${agentId}] trial ${detail.TrialIndex}: querying...`);
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
  if (result.response === undefined) {
    log?.('error', `[${agentId}] trial ${detail.TrialIndex}: no answer, so a miss (${result.error})`);
    return undefined;
  }
  log?.('info', `[${agentId}] trial ${detail.TrialIndex} -> "${result.response}"`);
  return { response: result.response, agentId };
}
