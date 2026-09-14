import { buildPrompt } from '@skills/behaverse/browser/llm/prompt';
import type {
  LLMBotInput,
  LLMProviderConfig,
  ProviderRequest,
} from '@skills/behaverse/browser/llm/types';

type OllamaChatResponse = {
  message?: { content?: string };
  error?: string;
};

async function callClaude(req: ProviderRequest, proxyUrl: string): Promise<string> {
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

async function callOllama(req: ProviderRequest, ollamaUrl: string): Promise<string> {
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

/** The option the reply is, whole and without case; a reply that only mentions one names none ("NonMatch" holds "Match"). */
function matchResponseOption(raw: string, options: string[]): string | undefined {
  const reply = normalizeReply(raw).toLowerCase();
  return options.find((option) => option.toLowerCase() === reply);
}

/** The model's answer to one trial, or why there is none. */
export async function selectResponse(
  input: LLMBotInput,
  config: LLMProviderConfig,
): Promise<{ response?: string; error?: string }> {
  if (!input.responseOptions.length) return { error: 'no response options' };
  try {
    const req = buildPrompt(input, config.model);
    const raw = config.provider === 'claude'
      ? await callClaude(req, config.proxyUrl)
      : await callOllama(req, config.url);
    const response = matchResponseOption(raw, input.responseOptions);
    return response !== undefined ? { response } : { error: `the reply names no option: "${raw.slice(0, 80)}"` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
