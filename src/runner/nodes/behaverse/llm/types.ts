export type TrialHistoryEntry = {
  trialIndex: number;
  stimulus: unknown;
  chosenResponse: string;
};

export type LLMProviderConfig =
  | { provider: 'claude'; model: string; proxyUrl: string }
  | { provider: 'ollama'; model: string; url: string };

export type LLMBotInput = {
  taskId: string;
  taskConfig?: Record<string, unknown>;
  prompt: string;
  stimulus: unknown;
  responseOptions: string[];
  trialIndex: number;
  history: TrialHistoryEntry[];
  screenshot?: string;
};

export type ProviderRequest = {
  system: string;
  user: string;
  model: string;
  responseOptions: string[];
  image?: { mediaType: string; data: string };
};
