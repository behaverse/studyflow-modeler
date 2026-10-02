import { expect, test } from '@playwright/test';

import { decideResponse } from '@skills/behaverse/browser/botResponse';
import { buildPrompt } from '@skills/behaverse/browser/llm/prompt';
import type { LLMBotInput, ProviderRequest } from '@skills/behaverse/browser/llm/types';
import type { BehaverseBotPayload, BehaverseTaskPayload } from '@skills/behaverse/browser/types';
import type { AwaitingResponseDetail } from '@skills/behaverse/browser/unityTopics';

/** A model on a task's band, in the browser runner: what it is asked for each trial, and what Unity gets of its reply. */

const PROMPT = 'Answer Match or NonMatch.';

test('what a model is handed for a trial: the wired Prompt, the task, its earlier trials, the trial and its options, and a screenshot as an image', () => {
  const TRIAL: LLMBotInput = { taskId: 'NB', prompt: '', stimulus: { Value: 'A' }, responseOptions: ['Match', 'NonMatch'], trialIndex: 3, history: [] };
  // `shown` are lines of the user prompt, in that order; `hidden` is what no line holds.
  const CASES: { label: string; input: Partial<LLMBotInput>; system?: string; shown: string[]; hidden?: RegExp; image?: ProviderRequest['image'] }[] = [
    {
      label: 'a trial alone: the task, the trial\'s stimulus and options, and to reply with one',
      input: {},
      shown: ['Task: NB', 'Current trial 3:', '  stimulus: {"Value":"A"}', '  response options: Match, NonMatch',
        'Reply with exactly one of the response options. No explanation, no punctuation, no extra text.'],
      hidden: /Task configuration|Previous trials|screenshot/,
    },
    { label: 'the Prompt wired into the task is the system prompt', input: { prompt: `  ${PROMPT}\n` }, system: PROMPT, shown: ['Task: NB'] },
    {
      label: 'the task\'s GameConfig, as JSON',
      input: { taskConfig: { Bot: { Speed: 20 } } },
      shown: ['Task: NB', 'Task configuration:', '{', '  "Bot": {', '    "Speed": 20', '  }', '}', 'Current trial 3:'],
    },
    { label: 'an empty GameConfig is left out', input: { taskConfig: {} }, shown: ['Task: NB'], hidden: /Task configuration/ },
    {
      label: 'the trials before, each with the response chosen',
      input: { history: [{ trialIndex: 1, stimulus: { Value: 'B' }, chosenResponse: 'NonMatch' }, { trialIndex: 2, stimulus: null, chosenResponse: 'Match' }] },
      shown: ['Previous trials in this task:', '  trial 1: stimulus={"Value":"B"}, response=NonMatch', '  trial 2: stimulus=null, response=Match', 'Current trial 3:'],
    },
    { label: 'a stimulus of text is shown as it is', input: { stimulus: 'A' }, shown: ['  stimulus: A'] },
    {
      label: 'a screenshot the build took goes as an image, its base64 unwrapped, and the model is told to go by it',
      input: { screenshot: 'data:image/png;base64,iVBORw0K\nGgo=' },
      shown: ['  response options: Match, NonMatch', '  screenshot: attached (use the image to decide; ignore the textual stimulus if they disagree)'],
      image: { mediaType: 'image/png', data: 'iVBORw0KGgo=' },
    },
    { label: 'a screenshot that is not a base64 data URL is no image', input: { screenshot: 'https://example.org/shot.png' }, shown: ['Task: NB'], hidden: /screenshot/ },
  ];

  for (const { label, input, system, shown, hidden, image } of CASES) {
    const request = buildPrompt({ ...TRIAL, ...input }, 'claude-haiku-4-5');
    expect(request, label).toMatchObject({ model: 'claude-haiku-4-5', responseOptions: ['Match', 'NonMatch'] });
    if (system) expect(request.system, label).toBe(system);
    else expect(request.system, `${label}: with no Prompt, the default`).toMatch(/simulating a participant[\s\S]*exactly one of the response options/);
    const lines = request.user.split('\n');
    let at = -1;
    for (const line of shown) {
      const next = lines.indexOf(line, at + 1);
      expect(next, `${label}: "${line}", after the line before it`).toBeGreaterThan(at);
      at = next;
    }
    if (hidden) expect(request.user, label).not.toMatch(hidden);
    expect(request.image, label).toEqual(image);
  }
});

const AWAITING: AwaitingResponseDetail = { RequestId: 'r1', TrialIndex: 3, Stimulus: { Value: 'A' }, ResponseOptions: ['Match', 'NonMatch'], MaxResponseTime: 2 };
const SCREENSHOT = { Screenshot: 'data:image/png;base64,iVBORw0KGgo=' };
const CLAUDE: BehaverseBotPayload = { ResponseSource: 'llm', LLM: { Provider: 'claude', Model: 'claude-haiku-4-5' }, Prompt: PROMPT };
const OLLAMA: BehaverseBotPayload = { ResponseSource: 'llm', LLM: { Provider: 'ollama', Model: 'gemma3' }, Prompt: PROMPT };

const json = (body: unknown) => () => new Response(JSON.stringify(body));

test('a model on the band answers a trial through its provider, with the option its reply names; a reply naming none, or a failed call, is a miss', async () => {
  const CASES: {
    label: string;
    bot: BehaverseBotPayload;
    trial?: Partial<AwaitingResponseDetail>;
    reply?: () => Response;
    /** The one request the provider gets, if any. */
    asked?: { url: string; body: unknown };
    answer?: { response: string; agentId: string };
    logged?: RegExp;
  }[] = [
    { label: 'the build\'s own bot answers for itself: no model is asked', bot: { Speed: 20 } },
    {
      label: 'Claude is asked through the dev server\'s proxy, with the wired Prompt and the trial',
      bot: CLAUDE,
      reply: json({ response: ' "Match". ' }),
      asked: { url: '/api/llm/claude/respond', body: { system: PROMPT, user: expect.stringContaining('Current trial 3:'), model: 'claude-haiku-4-5' } },
      answer: { response: 'Match', agentId: 'claude:claude-haiku-4-5' },
    },
    {
      label: 'a screenshot goes to Claude as an image',
      bot: CLAUDE,
      trial: SCREENSHOT,
      reply: json({ response: 'NonMatch' }),
      asked: { url: '/api/llm/claude/respond', body: expect.objectContaining({ image: { mediaType: 'image/png', data: 'iVBORw0KGgo=' } }) },
      answer: { response: 'NonMatch', agentId: 'claude:claude-haiku-4-5' },
    },
    {
      label: 'Ollama is asked at its chat endpoint, the screenshot as the user\'s image',
      bot: OLLAMA,
      trial: SCREENSHOT,
      reply: json({ message: { content: 'nonmatch' } }),
      asked: {
        url: 'http://localhost:11434/api/chat',
        body: expect.objectContaining({
          model: 'gemma3',
          stream: false,
          messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: expect.stringContaining('Current trial 3:'), images: ['iVBORw0KGgo='] }],
        }),
      },
      answer: { response: 'NonMatch', agentId: 'ollama:gemma3' },
    },
    {
      label: 'a reply that only mentions an option answers nothing',
      bot: CLAUDE,
      reply: json({ response: 'It is Match' }),
      asked: { url: '/api/llm/claude/respond', body: expect.anything() },
      logged: /^error: \[claude:claude-haiku-4-5\] trial 3: no answer, so a miss \(the reply names no option: "It is Match"\)$/,
    },
    {
      label: 'a provider that fails answers nothing',
      bot: OLLAMA,
      reply: () => new Response('model "gemma3" not found', { status: 404 }),
      asked: { url: 'http://localhost:11434/api/chat', body: expect.anything() },
      logged: /^error: \[ollama:gemma3\] trial 3: no answer, so a miss \(Ollama responded 404: model "gemma3" not found\)$/,
    },
  ];

  const fetchBefore = globalThis.fetch;
  try {
    for (const { label, bot, trial, reply, asked, answer, logged } of CASES) {
      const requests: { url: string; body: unknown }[] = [];
      globalThis.fetch = (async (url: string, init: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init.body)) });
        return reply!();
      }) as typeof fetch;
      const log: string[] = [];
      const payload: BehaverseTaskPayload = { scene: 'NB', timeline: 'XCIT_NB_01', configMode: 'builtin', agentType: 'bot', metadata: { studyflowNodeId: 'T' }, bot };
      const decision = await decideResponse(payload, { ...AWAITING, ...trial }, [], (kind, message) => log.push(`${kind}: ${message}`));
      expect(requests, label).toEqual(asked ? [asked] : []);
      expect(decision, label).toEqual(answer);
      if (logged) expect(log.at(-1), label).toMatch(logged);
    }
  } finally {
    globalThis.fetch = fetchBefore;
  }
});
