import { buildPrompt } from '@/runner/models/nodes/behaverse/llm/prompt';
import { matchResponseOption, normalizeReply } from '@/runner/models/nodes/behaverse/response';
import { callClaude } from '@/runner/infra/nodes/behaverse/llm/providers/claude';
import { callOllama } from '@/runner/infra/nodes/behaverse/llm/providers/ollama';
import type { LLMBotInput, LLMProviderConfig } from '@/runner/models/nodes/behaverse/llm/types';

/** Select a response via the provider, with random fallback. */
export async function selectResponse(
  input: LLMBotInput,
  config: LLMProviderConfig,
): Promise<{ response: string; source: 'llm' | 'random'; error?: string }> {
  if (!input.responseOptions.length) {
    return { response: '', source: 'random', error: 'no response options' };
  }
  try {
    const req = buildPrompt(input, config.model);
    const raw = config.provider === 'claude'
      ? await callClaude(req, config.proxyUrl)
      : await callOllama(req, config.url);
    const chosen = matchResponseOption(raw, input.responseOptions);
    const wasInOptions = input.responseOptions.some(
      (a) => a.toLowerCase() === normalizeReply(raw).toLowerCase(),
    );
    return wasInOptions
      ? { response: chosen, source: 'llm' }
      : { response: chosen, source: 'random', error: `LLM reply not in response options: "${raw.slice(0, 80)}"` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const random = input.responseOptions[Math.floor(Math.random() * input.responseOptions.length)];
    return { response: random, source: 'random', error: message };
  }
}
