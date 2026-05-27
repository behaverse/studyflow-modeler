import { RUNNER_ONLY_BOT_KEYS, type BehaverseBotPayload, type BehaverseTaskPayload } from '@/runner/nodes/behaverse/types';
import { getLLMSettings } from '@/lib/core/runtimeSettings';
import { selectResponse } from '@/runner/nodes/behaverse/llm/bot';
import type { LLMProviderConfig, TrialHistoryEntry } from '@/runner/nodes/behaverse/llm/types';

/** Strip runner-only keys (e.g. `LLM`, `Prompt`) from the bot payload before
 *  sending to Unity; `BotReflection.Apply` throws on unknown field names.
 *  Also normalize `ResponseSource: llm` to `external`: Unity's per-game checks
 *  hardcode the string `"external"` to switch into runner-driven response mode,
 *  so `llm` (a runner-only discriminator) would silently fall back to internal. */
function botForUnity(bot: BehaverseBotPayload | undefined): BehaverseBotPayload | undefined {
  if (!bot) return undefined;
  const runnerOnly = new Set<string>(RUNNER_ONLY_BOT_KEYS);
  const stripped: BehaverseBotPayload = {};
  for (const [k, v] of Object.entries(bot)) {
    if (runnerOnly.has(k)) continue;
    stripped[k] = k === 'ResponseSource' && v === 'llm' ? 'external' : v;
  }
  return Object.keys(stripped).length > 0 ? stripped : undefined;
}

type UnityInstance = {
  SendMessage: (gameObjectName: string, methodName: string, value?: string | number) => void;
};

type UnityWindow = Window & { unityInstance?: UnityInstance };

type TaskCompletion = {
  TaskId: string;
  TimelineId: string;
  IsCompleted: boolean;
};

/** Resolve effective LLM provider/model from per-task botConfig.LLM over global settings. */
function resolveLLMConfig(bot: BehaverseTaskPayload['bot']): LLMProviderConfig {
  const settings = getLLMSettings();
  const override = (bot && typeof bot === 'object' ? (bot as Record<string, unknown>).LLM : undefined);
  const llmOverride = override && typeof override === 'object' && !Array.isArray(override)
    ? (override as Record<string, unknown>)
    : {};
  const provider = llmOverride.Provider === 'ollama' || llmOverride.Provider === 'claude'
    ? llmOverride.Provider
    : settings.provider;
  const model = typeof llmOverride.Model === 'string' && llmOverride.Model.length > 0
    ? llmOverride.Model
    : settings.model;
  return {
    provider,
    model,
    ollamaUrl: settings.ollamaUrl,
    claudeProxyUrl: settings.claudeProxyUrl,
  };
}

function readResponseSource(bot: BehaverseTaskPayload['bot']): 'internal' | 'external' | 'llm' {
  if (!bot || typeof bot !== 'object') return 'internal';
  const value = (bot as Record<string, unknown>).ResponseSource;
  return value === 'external' || value === 'llm' ? value : 'internal';
}

function readPrompt(bot: BehaverseTaskPayload['bot']): string {
  if (!bot || typeof bot !== 'object') return '';
  const value = (bot as Record<string, unknown>).Prompt;
  return typeof value === 'string' ? value : '';
}

// Unity dispatches each topic as both a CustomEvent and a parent-window postMessage.
// Topic strings are PascalCase to mirror the C# source of truth (browser_bridge.jslib).
const TASK_COMPLETED = 'studyflow:TaskCompleted';
const AWAITING_RESPONSE = 'studyflow:AwaitingResponse';
const READY = 'studyflow:Ready';

type LogFn = (kind: 'info' | 'task' | 'ok' | 'error' | 'skip', message: string) => void;

/** Send a task to Unity and resolve when the matching TASK_COMPLETED event fires. */
export function runOnUnity(
  unity: UnityInstance,
  payload: BehaverseTaskPayload,
  getUnityWindow: () => UnityWindow | null,
  log?: LogFn,
): Promise<TaskCompletion> {
  return new Promise((resolve, reject) => {
    // Keys mirror C# field/JSON conventions (PascalCase, source of truth in Unity).
    type AwaitingResponseDetail = {
      RequestId: string;
      TrialIndex: number;
      Stimulus: { Value: string };
      ResponseOptions: string[];
      MaxResponseTime: number;  // seconds, matches Unity's MaxResponseTime config
      /** `data:image/png;base64,...` set by Unity when `Bot.IncludeScreenshot = true`.
       *  Forwarded to vision-capable LLM providers; ignored by `external`/`internal`. */
      Screenshot?: string;
    };

    const matches = (detail: TaskCompletion | undefined): detail is TaskCompletion =>
      !!detail
      && detail.TaskId === payload.task
      && (!payload.timeline || !detail.TimelineId || detail.TimelineId === payload.timeline);

    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; detail?: TaskCompletion } | undefined;
      if (data?.type !== TASK_COMPLETED) return;
      if (!matches(data.detail)) return;
      cleanup();
      resolve(data.detail);
    };

    const onCompleted = (e: Event) => {
      const detail = (e as CustomEvent<TaskCompletion>).detail;
      if (!matches(detail)) return;
      cleanup();
      resolve(detail);
    };

    const source = readResponseSource(payload.bot);
    const history: TrialHistoryEntry[] = [];
    // Unity emits each AwaitingResponse as BOTH a CustomEvent and a window
    // postMessage, so we receive every trial twice. Dedupe by RequestId to
    // avoid double LLM calls (wasted tokens) and duplicate sidebar logs.
    const seenRequestIds = new Set<string>();

    const sendResponse = (detail: AwaitingResponseDetail, response: string, agentId: string) => {
      try {
        unity.SendMessage('GameManager', 'InjectResponse', JSON.stringify({
          RequestId: detail.RequestId,
          Response: response,
          Agent: { Id: agentId },
        }));
        history.push({ trialIndex: detail.TrialIndex, stimulus: detail.Stimulus, chosenResponse: response });
      } catch {
        // swallow; the trial's natural maxResponseTime handles missed responses
      }
    };

    const handleAwaiting = async (detail: AwaitingResponseDetail | undefined) => {
      if (!detail || !Array.isArray(detail.ResponseOptions) || detail.ResponseOptions.length === 0) return;
      if (seenRequestIds.has(detail.RequestId)) return;
      seenRequestIds.add(detail.RequestId);

      if (source === 'llm') {
        const llmConfig = resolveLLMConfig(payload.bot);
        const result = await selectResponse({
          taskId: payload.task,
          taskConfig: payload.config,
          prompt: readPrompt(payload.bot),
          stimulus: detail.Stimulus,
          responseOptions: detail.ResponseOptions,
          trialIndex: detail.TrialIndex,
          history,
          ...(typeof detail.Screenshot === 'string' && detail.Screenshot.length > 0
            ? { screenshot: detail.Screenshot }
            : {}),
        }, llmConfig);
        if (result.source === 'llm') {
          log?.('info', `[${llmConfig.provider}:${llmConfig.model}] trial ${detail.TrialIndex} -> "${result.response}"`);
        } else if (result.error) {
          log?.('error', `[${llmConfig.provider}:${llmConfig.model}] trial ${detail.TrialIndex} -> fall back to random "${result.response}": ${result.error}`);
          console.warn(`[behaverse:llm] trial ${detail.TrialIndex} fell back to random: ${result.error}`);
        }
        // When the LLM actually answered, tag the response with `<provider>:<model>`
        // so downstream telemetry can distinguish LLM-driven from random-fallback
        // trials. On random fallback, keep the generic `bot` tag.
        const agentId = result.source === 'llm' ? `${llmConfig.provider}:${llmConfig.model}` : 'bot';
        sendResponse(detail, result.response, agentId);
        return;
      }

      const response = detail.ResponseOptions[Math.floor(Math.random() * detail.ResponseOptions.length)];
      sendResponse(detail, response, 'bot');
    };

    const onAwaitingMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; detail?: AwaitingResponseDetail } | undefined;
      if (data?.type !== AWAITING_RESPONSE) return;
      void handleAwaiting(data.detail);
    };

    const onAwaiting = (e: Event) => {
      void handleAwaiting((e as CustomEvent<AwaitingResponseDetail>).detail);
    };

    const cleanup = () => {
      window.removeEventListener(TASK_COMPLETED, onCompleted as EventListener);
      window.removeEventListener('message', onMessage);
      getUnityWindow()?.removeEventListener(TASK_COMPLETED, onCompleted as EventListener);
      window.removeEventListener(AWAITING_RESPONSE, onAwaiting as EventListener);
      window.removeEventListener('message', onAwaitingMessage);
      getUnityWindow()?.removeEventListener(AWAITING_RESPONSE, onAwaiting as EventListener);
    };

    window.addEventListener(TASK_COMPLETED, onCompleted as EventListener);
    window.addEventListener('message', onMessage);
    getUnityWindow()?.addEventListener(TASK_COMPLETED, onCompleted as EventListener);
    window.addEventListener(AWAITING_RESPONSE, onAwaiting as EventListener);
    window.addEventListener('message', onAwaitingMessage);
    getUnityWindow()?.addEventListener(AWAITING_RESPONSE, onAwaiting as EventListener);

    try {
      const unityPayload = { ...payload, bot: botForUnity(payload.bot) };
      unity.SendMessage('GameManager', 'RunTask', JSON.stringify(unityPayload));
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

/** Wait for `studyflow:Ready` — the combined signal that Unity is loaded AND
 *  GameManager is up. Resolves with the `unityInstance` handle. */
export function waitForReady(
  getIframe: () => HTMLIFrameElement | null,
  timeoutMs = 60_000,
): Promise<UnityInstance> {
  return new Promise((resolve, reject) => {
    const resolveFromIframe = () => {
      const iframeWindow = getIframe()?.contentWindow as UnityWindow | null | undefined;
      return iframeWindow?.unityInstance ?? ((window as any).unityInstance as UnityInstance | undefined);
    };

    const readyFlagSet = () => {
      const iframeWindow = getIframe()?.contentWindow as (UnityWindow & { studyflowReady?: boolean }) | null | undefined;
      return iframeWindow?.studyflowReady === true || (window as any).studyflowReady === true;
    };

    // If we attached too late and the event already fired, the jslib sets
    // `studyflowReady = true` on the iframe (and the template forwards it to
    // the parent) — pick it up on the first tick.
    if (readyFlagSet()) {
      const instance = resolveFromIframe();
      if (instance) {
        resolve(instance);
        return;
      }
    }

    let attachedIframeWindow: UnityWindow | null = null;

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      window.removeEventListener(READY, onReady);
      window.clearInterval(pollTimer);
      attachedIframeWindow?.removeEventListener(READY, onReady);
    };

    const onReady = () => {
      const instance = resolveFromIframe();
      if (!instance) return;
      cleanup();
      resolve(instance);
    };

    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | undefined)?.type === READY) onReady();
    };

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for Unity to be ready.'));
    }, timeoutMs);

    const pollTimer = window.setInterval(() => {
      const iframeWindow = getIframe()?.contentWindow as UnityWindow | null | undefined;
      if (iframeWindow && iframeWindow !== attachedIframeWindow) {
        attachedIframeWindow?.removeEventListener(READY, onReady);
        attachedIframeWindow = iframeWindow;
        attachedIframeWindow.addEventListener(READY, onReady, { once: true });
      }
      if (readyFlagSet()) onReady();
    }, 100);

    window.addEventListener('message', onMessage);
    window.addEventListener(READY, onReady);
  });
}
