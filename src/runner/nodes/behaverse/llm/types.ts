/** One entry in the per-task trial history fed into the LLM prompt. */
export type TrialHistoryEntry = {
  trialIndex: number;
  stimulus: unknown;
  chosenResponse: string;
};

/** Provider identity + model + the active provider's endpoint. Discriminated on
 *  `provider`: after narrowing, only that provider's endpoint field is present.
 *  The bot resolves this from per-task `botConfigurations.LLM` over global settings. */
export type LLMProviderConfig =
  | { provider: 'claude'; model: string; proxyUrl: string }
  | { provider: 'ollama'; model: string; url: string };

/** Everything the bot needs to choose a response for one `AwaitingResponse`. */
export type LLMBotInput = {
  taskId: string;
  taskConfig?: Record<string, unknown>;
  prompt: string;
  stimulus: unknown;
  responseOptions: string[];
  trialIndex: number;
  history: TrialHistoryEntry[];
  /** Optional `data:image/<type>;base64,<payload>` URL captured by Unity when the
   *  bot has `IncludeScreenshot: true`. Providers attach it as a real image so
   *  vision-capable models can read visual stimuli. */
  screenshot?: string;
};

/** Shape returned by every provider; `response` must already be in `responseOptions`,
 *  or the bot falls back to random. */
export type ProviderRequest = {
  system: string;
  user: string;
  model: string;
  responseOptions: string[];
  /** Parsed-out image payload when the bot input carried a screenshot.
   *  `mediaType` is the MIME type (e.g. `image/png`); `data` is bare base64
   *  with no `data:` prefix and no whitespace. */
  image?: { mediaType: string; data: string };
};
