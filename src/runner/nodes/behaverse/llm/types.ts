/** One entry in the per-task trial history fed into the LLM prompt. */
export type TrialHistoryEntry = {
  trialIndex: number;
  stimulus: unknown;
  chosenResponse: string;
};

/** Provider identity + model. Either field can be missing; the responder resolves
 *  per-task `botConfig.LLM` over global settings. */
export type LLMProviderConfig = {
  provider: 'claude' | 'ollama';
  model: string;
  ollamaUrl: string;
  claudeProxyUrl: string;
};

/** Everything the responder needs to choose a response for one `AwaitingResponse`. */
export type LLMResponderInput = {
  taskId: string;
  taskConfig?: Record<string, unknown>;
  prompt: string;
  stimulus: unknown;
  allowedResponses: string[];
  trialIndex: number;
  history: TrialHistoryEntry[];
  /** Optional `data:image/<type>;base64,<payload>` URL captured by Unity when the
   *  bot has `IncludeScreenshot: true`. Providers attach it as a real image so
   *  vision-capable models can read visual stimuli. */
  screenshot?: string;
};

/** Shape returned by every provider; `response` must already be in `allowedResponses`,
 *  or the responder falls back to random. */
export type ProviderRequest = {
  system: string;
  user: string;
  model: string;
  allowedResponses: string[];
  /** Parsed-out image payload when the responder input carried a screenshot.
   *  `mediaType` is the MIME type (e.g. `image/png`); `data` is bare base64
   *  with no `data:` prefix and no whitespace. */
  image?: { mediaType: string; data: string };
};
