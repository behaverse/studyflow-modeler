import type { ProviderRequest } from '@/runner/models/nodes/behaverse/llm/types';

type OllamaChatResponse = {
  message?: { content?: string };
  error?: string;
};

/** Call a local Ollama server's /api/chat endpoint and return the raw text reply.
 *  Ollama needs `OLLAMA_ORIGINS=*` (or matching origin) for browser fetch to work.
 *  When `req.image` is set it is attached via Ollama's documented `images: []`
 *  field; this requires a vision-capable model (e.g. `llava`, `llama3.2-vision`). */
export async function callOllama(req: ProviderRequest, ollamaUrl: string): Promise<string> {
  const userMessage: Record<string, unknown> = { role: 'user', content: req.user };
  if (req.image) userMessage.images = [req.image.data];

  const res = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: req.model,
      stream: false,
      // Disable reasoning preambles on models that emit a `thinking` field
      // (e.g. gemma3n / gemma4 small variants). Without this, the reasoning
      // tokens consume `num_predict` and the actual `content` is truncated empty.
      // No-op for non-reasoning models.
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
