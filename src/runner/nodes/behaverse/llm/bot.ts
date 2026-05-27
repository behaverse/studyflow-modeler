import { buildPrompt } from './prompt';
import { callClaude } from './providers/claude';
import { callOllama } from './providers/ollama';
import type { LLMBotInput, LLMProviderConfig } from './types';

/** Pick the response option which is contained in (or contains)
 *  the LLM's raw text. Falls back to a random choice. */
function matchResponseOption(raw: string, options: string[]): string {
  const cleaned = raw.trim().replace(/^[`"'\s]+|[`"'.\s]+$/g, '');
  const lower = cleaned.toLowerCase();

  // exact match
  for (const c of options) {
    if (c.toLowerCase() === lower) return c;
  }

  // inclusion
  for (const c of options) {
    if (lower.includes(c.toLowerCase())) return c;
  }
  return options[Math.floor(Math.random() * options.length)];
}

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
      ? await callClaude(req, config.claudeProxyUrl)
      : await callOllama(req, config.ollamaUrl);
    const chosen = matchResponseOption(raw, input.responseOptions);
    const wasInOptions = input.responseOptions.some(
      (a) => a.toLowerCase() === raw.trim().replace(/^[`"'\s]+|[`"'.\s]+$/g, '').toLowerCase(),
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
