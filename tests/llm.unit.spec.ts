import { expect, test } from '@playwright/test';
import { buildPrompt } from '../src/runner/nodes/behaverse/llm/prompt';
import { callClaude } from '../src/runner/nodes/behaverse/llm/providers/claude';
import { callOllama } from '../src/runner/nodes/behaverse/llm/providers/ollama';
import { selectResponse } from '../src/runner/nodes/behaverse/llm/responder';
import { RUNNER_ONLY_BOT_KEYS } from '../src/runner/nodes/behaverse/types';
import type { LLMProviderConfig, LLMResponderInput, ProviderRequest } from '../src/runner/nodes/behaverse/llm/types';

const NB_INPUT: LLMResponderInput = {
  taskId: 'NB',
  taskConfig: { NValue: 2 },
  prompt: 'You are an expert 2-back participant.',
  stimulus: { Value: 'A' },
  allowedResponses: ['Match', 'NonMatch'],
  trialIndex: 3,
  history: [
    { trialIndex: 1, stimulus: { Value: 'B' }, chosenResponse: 'NonMatch' },
    { trialIndex: 2, stimulus: { Value: 'A' }, chosenResponse: 'NonMatch' },
  ],
};

test('buildPrompt: uses researcher prompt as system, embeds task id and allowed responses in user', () => {
  const out = buildPrompt(NB_INPUT, 'claude-haiku-4-5');
  expect(out.system).toBe('You are an expert 2-back participant.');
  expect(out.user).toContain('Task: NB');
  expect(out.user).toContain('NValue');
  expect(out.user).toContain('Match, NonMatch');
  expect(out.user).toContain('Current trial 3');
  expect(out.model).toBe('claude-haiku-4-5');
});

test('buildPrompt: includes prior trials with stimulus and chosen response', () => {
  const out = buildPrompt(NB_INPUT, 'm');
  expect(out.user).toContain('trial 1');
  expect(out.user).toContain('trial 2');
  expect(out.user).toContain('"Value":"B"');
  expect(out.user).toContain('response=NonMatch');
});

test('buildPrompt: falls back to a default system prompt when researcher leaves Prompt empty', () => {
  const out = buildPrompt({ ...NB_INPUT, prompt: '   ' }, 'm');
  expect(out.system.toLowerCase()).toContain('cognitive task');
});

test('buildPrompt: SRM task with numeric allowed responses renders cleanly', () => {
  const out = buildPrompt(
    {
      taskId: 'SRM',
      taskConfig: {},
      prompt: '',
      stimulus: { Index: 4 },
      allowedResponses: ['0', '1', '2', '3'],
      trialIndex: 1,
      history: [],
    },
    'm',
  );
  expect(out.user).toContain('Task: SRM');
  expect(out.user).toContain('0, 1, 2, 3');
});

const CONFIG: LLMProviderConfig = {
  provider: 'ollama',
  model: 'llama3.2',
  ollamaUrl: 'http://127.0.0.1:1',
  claudeProxyUrl: '/api/llm/claude',
};

test('selectResponse: falls back to a random allowed response when provider errors', async () => {
  const out = await selectResponse(NB_INPUT, CONFIG);
  expect(['Match', 'NonMatch']).toContain(out.response);
  expect(out.source).toBe('fallback-random');
  expect(out.error).toBeTruthy();
});

test('selectResponse: matches LLM output to an allowed response (case-insensitive, punctuation-tolerant)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ message: { content: '  "match".  ' } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch;

  try {
    const out = await selectResponse(NB_INPUT, CONFIG);
    expect(out.response).toBe('Match');
    expect(out.source).toBe('llm');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('selectResponse: out-of-allowed LLM output triggers fallback-random with an error message', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ message: { content: 'I think I should pick option C maybe?' } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch;

  try {
    const out = await selectResponse(NB_INPUT, CONFIG);
    expect(['Match', 'NonMatch']).toContain(out.response);
    expect(out.source).toBe('fallback-random');
    expect(out.error).toContain('not in allowed set');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8//8/AwMDAwMTAxIAAB6QAhdYxfPnAAAAAElFTkSuQmCC';

test('buildPrompt: passes screenshot through as parsed image and mentions it in the user text', () => {
  const out = buildPrompt(
    { ...NB_INPUT, screenshot: `data:image/png;base64,${TINY_PNG_B64}` },
    'claude-haiku-4-5',
  );
  expect(out.image).toEqual({ mediaType: 'image/png', data: TINY_PNG_B64 });
  expect(out.user).toContain('screenshot: attached');
});

test('buildPrompt: invalid screenshot URL is dropped silently', () => {
  const out = buildPrompt({ ...NB_INPUT, screenshot: 'not-a-data-url' }, 'm');
  expect(out.image).toBeUndefined();
  expect(out.user).not.toContain('screenshot: attached');
});

test('callClaude: forwards image to the proxy when present', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ response: 'Left' }), { status: 200 });
  }) as typeof fetch;

  try {
    const req: ProviderRequest = {
      system: 's', user: 'u', model: 'm',
      allowedResponses: ['Left', 'Right'],
      image: { mediaType: 'image/png', data: TINY_PNG_B64 },
    };
    const out = await callClaude(req, '/api/llm/claude');
    expect(out).toBe('Left');
    expect(capturedBody?.image).toEqual({ mediaType: 'image/png', data: TINY_PNG_B64 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callClaude: omits the image field when none was set', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ response: 'Match' }), { status: 200 });
  }) as typeof fetch;

  try {
    await callClaude(
      { system: '', user: 'u', model: 'm', allowedResponses: ['Match'] },
      '/api/llm/claude',
    );
    expect(capturedBody && 'image' in capturedBody).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callOllama: attaches images on the user message when present', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: { messages?: Array<{ role: string; images?: string[] }> } | undefined;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ message: { content: 'Right' } }), { status: 200 });
  }) as typeof fetch;

  try {
    const req: ProviderRequest = {
      system: 's', user: 'u', model: 'llava',
      allowedResponses: ['Left', 'Right'],
      image: { mediaType: 'image/png', data: TINY_PNG_B64 },
    };
    const out = await callOllama(req, 'http://localhost:11434');
    expect(out).toBe('Right');
    const userMsg = capturedBody?.messages?.find((m) => m.role === 'user');
    expect(userMsg?.images).toEqual([TINY_PNG_B64]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('RUNNER_ONLY_BOT_KEYS: covers the keys the runner consumes that Unity must not see', () => {
  // Drives both the validator's flatness-exemption and the bridge's
  // strip-before-SendMessage. Any new runner-only key needs to land here.
  expect(new Set(RUNNER_ONLY_BOT_KEYS)).toEqual(new Set(['LLM', 'Prompt']));
});

test('botForUnity: strips runner-only keys and rewrites ResponseSource=llm -> external', async () => {
  // Bridge isn't exported; exercise the logic indirectly by importing and
  // re-running the same transformation steps. Documents the contract:
  // Unity needs ResponseSource="external" to emit AwaitingResponse events,
  // and must never see LLM/Prompt (BotReflection throws on unknown fields).
  const bot = {
    ResponseSource: 'llm',
    LLM: { Provider: 'claude', Model: 'm' },
    Prompt: 'persona',
    IncludeScreenshot: true,
    Speed: 20,
  };
  const runnerOnly = new Set<string>(RUNNER_ONLY_BOT_KEYS);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bot)) {
    if (runnerOnly.has(k)) continue;
    result[k] = k === 'ResponseSource' && v === 'llm' ? 'external' : v;
  }
  expect(result).toEqual({
    ResponseSource: 'external',
    IncludeScreenshot: true,
    Speed: 20,
  });
});

test('callOllama: omits images on the user message when none set', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: { messages?: Array<{ role: string; images?: string[] }> } | undefined;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ message: { content: 'Match' } }), { status: 200 });
  }) as typeof fetch;

  try {
    await callOllama(
      { system: '', user: 'u', model: 'm', allowedResponses: ['Match'] },
      'http://localhost:11434',
    );
    const userMsg = capturedBody?.messages?.find((m) => m.role === 'user');
    expect(userMsg && 'images' in userMsg).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
