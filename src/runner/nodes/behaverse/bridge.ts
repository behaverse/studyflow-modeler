import type { BehaverseTaskPayload } from '@/runner/nodes/behaverse/types';

type UnityInstance = {
  SendMessage: (gameObjectName: string, methodName: string, value?: string | number) => void;
};

type UnityWindow = Window & { unityInstance?: UnityInstance };

type TaskCompletion = {
  taskId: string;
  timelineId: string;
  isCompleted: boolean;
};

// Unity dispatches each topic as both a CustomEvent and a parent-window postMessage.
// Topic strings are PascalCase to mirror the C# source of truth (browser_bridge.jslib).
const TASK_COMPLETED = 'studyflow:TaskCompleted';
const AWAITING_RESPONSE = 'studyflow:AwaitingResponse';
const UNITY_READY = 'studyflow:UnityReady';
const RUNNER_READY = 'studyflow:RunnerReady';

/** Send a task to Unity and resolve when the matching TASK_COMPLETED event fires. */
export function runOnUnity(
  unity: UnityInstance,
  payload: BehaverseTaskPayload,
  getUnityWindow: () => UnityWindow | null,
): Promise<TaskCompletion> {
  return new Promise((resolve, reject) => {
    // Keys mirror C# field/JSON conventions (PascalCase, source of truth in Unity).
    type AwaitingResponseDetail = {
      RequestId: string;
      TrialIndex: number;
      Stimulus: { Value: string };
      AllowedResponses: string[];
      MaxResponseTime: number;  // seconds, matches Unity's MaxResponseTime config
    };

    const matches = (detail: TaskCompletion | undefined): detail is TaskCompletion =>
      !!detail
      && detail.taskId === payload.task
      && (!payload.timeline || !detail.timelineId || detail.timelineId === payload.timeline);

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

    const handleAwaiting = (detail: AwaitingResponseDetail | undefined) => {
      if (!detail || !Array.isArray(detail.AllowedResponses) || detail.AllowedResponses.length === 0) return;
      const response = detail.AllowedResponses[Math.floor(Math.random() * detail.AllowedResponses.length)];
      try {
        unity.SendMessage('GameManager', 'InjectResponse', JSON.stringify({
          RequestId: detail.RequestId,
          Response: response,
          Agent: { Name: 'bot' },
        }));
      } catch {
        // swallow; the trial's natural maxResponseTime handles missed responses
      }
    };

    const onAwaitingMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; detail?: AwaitingResponseDetail } | undefined;
      if (data?.type !== AWAITING_RESPONSE) return;
      handleAwaiting(data.detail);
    };

    const onAwaiting = (e: Event) => {
      handleAwaiting((e as CustomEvent<AwaitingResponseDetail>).detail);
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
      unity.SendMessage('GameManager', 'RunTask', JSON.stringify(payload));
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

/** Wait for the WebGL template to expose `window.unityInstance`. */
export function waitForUnity(
  getIframe: () => HTMLIFrameElement | null,
  timeoutMs = 60_000,
): Promise<UnityInstance> {
  return new Promise((resolve, reject) => {
    const resolveFromIframe = () => {
      const iframeWindow = getIframe()?.contentWindow as UnityWindow | null | undefined;
      return iframeWindow?.unityInstance ?? ((window as any).unityInstance as UnityInstance | undefined);
    };

    const existing = resolveFromIframe();
    if (existing) {
      resolve(existing);
      return;
    }

    let iframeWindow: UnityWindow | null = null;
    let attachedIframeWindow: UnityWindow | null = null;

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      window.removeEventListener(UNITY_READY, onReady as EventListener);
      window.clearInterval(pollTimer);
      attachedIframeWindow?.removeEventListener(UNITY_READY, onReady as EventListener);
    };

    const onReady = (e: Event) => {
      const detail = (e as CustomEvent<{ unityInstance: UnityInstance }>).detail;
      const instance = detail?.unityInstance ?? resolveFromIframe();
      if (!instance) return;
      cleanup();
      resolve(instance);
    };

    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string } | undefined;
      if (data?.type !== UNITY_READY) return;
      const instance = resolveFromIframe();
      if (!instance) return;
      cleanup();
      resolve(instance);
    };

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for Unity to load.'));
    }, timeoutMs);

    const pollTimer = window.setInterval(() => {
      iframeWindow = getIframe()?.contentWindow as UnityWindow | null | undefined;
      if (iframeWindow && iframeWindow !== attachedIframeWindow) {
        attachedIframeWindow?.removeEventListener(UNITY_READY, onReady as EventListener);
        attachedIframeWindow = iframeWindow;
        attachedIframeWindow.addEventListener(UNITY_READY, onReady as EventListener, { once: true });
      }
      const instance = resolveFromIframe();
      if (!instance) return;
      cleanup();
      resolve(instance);
    }, 100);

    window.addEventListener('message', onMessage);
    window.addEventListener(UNITY_READY, onReady as EventListener);
  });
}

/** Wait for the GameManager `runnerReady` signal; resolves `'timeout'` for older builds without it. */
export function waitForRunnerReady(
  getIframe: () => HTMLIFrameElement | null,
  timeoutMs = 5_000,
): Promise<'ready' | 'timeout'> {
  return new Promise((resolve) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      window.removeEventListener(RUNNER_READY, onReady);
      getIframe()?.contentWindow?.removeEventListener(RUNNER_READY, onReady);
    };

    const onReady = () => {
      cleanup();
      resolve('ready');
    };

    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | undefined)?.type === RUNNER_READY) onReady();
    };

    const timer = window.setTimeout(() => {
      cleanup();
      resolve('timeout');
    }, timeoutMs);

    window.addEventListener(RUNNER_READY, onReady);
    window.addEventListener('message', onMessage);
    getIframe()?.contentWindow?.addEventListener(RUNNER_READY, onReady);
  });
}
