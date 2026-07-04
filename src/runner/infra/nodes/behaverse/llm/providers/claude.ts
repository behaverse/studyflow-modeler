import type { ProviderRequest } from '@/runner/models/nodes/behaverse/llm/types';

/** Call the Claude Max proxy (Vite dev middleware) and return the raw text reply.
 *  When `req.image` is set the proxy switches to stream-json mode so the image
 *  is forwarded to the underlying `claude` CLI as an Anthropic content block. */
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
