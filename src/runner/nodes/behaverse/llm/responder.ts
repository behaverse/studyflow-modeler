import { buildPrompt } from './prompt';
import { callClaude } from './providers/claude';
import { callOllama } from './providers/ollama';
import type { LLMProviderConfig, LLMResponderInput } from './types';

/** Pick the allowed response whose normalized form is contained in (or contains)
 *  the LLM's raw text. Falls back to a random allowed response. */
function matchAllowedResponse(raw: string, allowed: string[]): string {
  const cleaned = raw.trim().replace(/^[`"'\s]+|[`"'.\s]+$/g, '');
  const lower = cleaned.toLowerCase();

  for (const candidate of allowed) {
    if (candidate.toLowerCase() === lower) return candidate;
  }
  for (const candidate of allowed) {
    if (lower.includes(candidate.toLowerCase())) return candidate;
  }
  return allowed[Math.floor(Math.random() * allowed.length)];
}

/** Select a response via the configured provider, with random fallback on any error. */
export async function selectResponse(
  input: LLMResponderInput,
  config: LLMProviderConfig,
): Promise<{ response: string; source: 'llm' | 'fallback-random'; error?: string }> {
  if (!input.allowedResponses.length) {
    return { response: '', source: 'fallback-random', error: 'no allowed responses' };
  }
  try {
    const req = buildPrompt(input, config.model);
    const raw = config.provider === 'claude'
      ? await callClaude(req, config.claudeProxyUrl)
      : await callOllama(req, config.ollamaUrl);
    const chosen = matchAllowedResponse(raw, input.allowedResponses);
    const wasInAllowed = input.allowedResponses.some(
      (a) => a.toLowerCase() === raw.trim().replace(/^[`"'\s]+|[`"'.\s]+$/g, '').toLowerCase(),
    );
    return wasInAllowed
      ? { response: chosen, source: 'llm' }
      : { response: chosen, source: 'fallback-random', error: `LLM reply not in allowed set: "${raw.slice(0, 80)}"` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const random = input.allowedResponses[Math.floor(Math.random() * input.allowedResponses.length)];
    return { response: random, source: 'fallback-random', error: message };
  }
}
