import type { BehaverseTaskPayload } from '@runner/nodes/behaverse/types';
import type { TrialHistoryEntry } from '@runner/nodes/behaverse/llm/types';
import { decideResponse } from '@runner/nodes/behaverse/botResponse';
import type { LogFn } from '@runner/nodes/types';
import { botForUnity } from '@runner/nodes/behaverse/botConfig';
import {
  AWAITING_RESPONSE,
  READY,
  TASK_COMPLETED,
  subscribeUnityTopic,
  type AwaitingResponseDetail,
  type TaskCompletion,
  type UnityInstance,
  type UnityWindow,
} from '@runner/nodes/behaverse/unityTopics';

const RUNTIME_OBJECTS = ['AssessmentRuntime', 'GameManager'] as const;

function sendToRuntime(unity: UnityInstance, method: string, json: string): void {
  for (const name of RUNTIME_OBJECTS) unity.SendMessage(name, method, json);
}

export function runOnUnity(
  unity: UnityInstance,
  payload: BehaverseTaskPayload,
  getUnityWindow: () => UnityWindow | null,
  log?: LogFn,
): Promise<TaskCompletion> {
  return new Promise((resolve, reject) => {
    const history: TrialHistoryEntry[] = [];
    // Every topic arrives on multiple channels (see unityTopics.ts), so each trial is seen more than once.
    const seenRequestIds = new Set<string>();

    const sendResponse = (detail: AwaitingResponseDetail, response: string, agentId: string) => {
      // BDM `response_option_index` - 0-based position of the chosen option in `ResponseOptions`.
      const responseOptionIndex = detail.ResponseOptions.indexOf(response);
      try {
        sendToRuntime(unity, 'InjectResponse', JSON.stringify({
          RequestId: detail.RequestId,
          Response: response,
          ResponseOptionIndex: responseOptionIndex,
          Agent: { Id: agentId },
        }));
        history.push({ trialIndex: detail.TrialIndex, stimulus: detail.Stimulus, chosenResponse: response });
      } catch {
        // swallow; the trial's natural maxResponseTime handles missed responses
      }
    };

    const onAwaiting = async (detail: AwaitingResponseDetail | undefined) => {
      if (!detail || !Array.isArray(detail.ResponseOptions) || detail.ResponseOptions.length === 0) return;
      if (seenRequestIds.has(detail.RequestId)) return;
      seenRequestIds.add(detail.RequestId);

      const decision = await decideResponse(payload, detail, history, log);
      sendResponse(detail, decision.response, decision.agentId);
    };

    const onCompleted = (detail: TaskCompletion | undefined) => {
      const matches = !!detail
        && detail.TaskId === payload.scene
        && (!payload.timeline || !detail.TimelineId || detail.TimelineId === payload.timeline);
      if (!matches) return;
      cleanup();
      resolve(detail);
    };

    const unsubscribe = [
      subscribeUnityTopic<TaskCompletion>(TASK_COMPLETED, getUnityWindow, onCompleted),
      subscribeUnityTopic<AwaitingResponseDetail>(AWAITING_RESPONSE, getUnityWindow, (detail) => {
        void onAwaiting(detail);
      }),
    ];
    const cleanup = () => unsubscribe.forEach((off) => off());

    try {
      const unityPayload = { ...payload, bot: botForUnity(payload.bot) };
      sendToRuntime(unity, 'RunCognitiveTask', JSON.stringify(unityPayload));
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

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
      reject(new Error(
        `The Behaverse assessment build did not load within ${Math.round(timeoutMs / 1000)}s. Behaverse tasks need it.`,
      ));
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
