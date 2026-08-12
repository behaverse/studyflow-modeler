import { buildPrompt } from '@runner/nodes/behaverse/llm/prompt';
import type {
  LLMBotInput,
  LLMProviderConfig,
  ProviderRequest,
} from '@runner/nodes/behaverse/llm/types';

type OllamaChatResponse = {
  message?: { content?: string };
  error?: string;
};

export async function callClaude(req: ProviderRequest, proxyUrl: string): Promise<string> {
  const res = await fetch(`${proxyUrl}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: req.system,
      user: req.user,
      model: req.model,
      ...(req.image ? { image: req.image } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Claude proxy responded ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json() as { response?: string };
  if (typeof data.response !== 'string') throw new Error('Claude proxy returned no `response` field');
  return data.response;
}

export async function callOllama(req: ProviderRequest, ollamaUrl: string): Promise<string> {
  const userMessage: Record<string, unknown> = { role: 'user', content: req.user };
  if (req.image) userMessage.images = [req.image.data];

  const res = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: req.model,
      stream: false,
      // Disable reasoning preambles on models that emit a `thinking` field (e.g. small gemma variants).
      think: false,
      messages: [
        { role: 'system', content: req.system },
        userMessage,
      ],
      options: {
        temperature: 0.7,
        num_predict: 32,
      },
    }),
  });
  if (!res.ok) throw new Error(`Ollama responded ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json() as OllamaChatResponse;
  if (data.error) throw new Error(`Ollama error: ${data.error}`);
  const content = data.message?.content;
  if (typeof content !== 'string') throw new Error('Ollama returned no message content');
  return content;
}

function normalizeReply(raw: string): string {
  return raw.trim().replace(/^[`"'\s]+|[`"'.\s]+$/g, '');
}

function matchResponseOption(raw: string, options: string[]): string {
  const lower = normalizeReply(raw).toLowerCase();

  for (const c of options) {
    if (c.toLowerCase() === lower) return c;
  }

  for (const c of options) {
    if (lower.includes(c.toLowerCase())) return c;
  }
  return options[Math.floor(Math.random() * options.length)];
}

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
