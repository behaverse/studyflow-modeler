import type { BehaverseTaskPayload } from './types';

export type UnityInstance = {
  SendMessage: (gameObjectName: string, methodName: string, value?: string | number) => void;
};

type UnityWindow = Window & { unityInstance?: UnityInstance };

export type TaskCompletion = {
  taskId: string;
  timelineId: string;
  isCompleted: boolean;
};

const COMPLETION_EVENT = 'studyflow:taskCompleted';
const READY_MESSAGE = 'studyflow:unityReady';
const COMPLETION_MESSAGE = 'studyflow:taskCompleted';
const RUNNER_READY_EVENT = 'studyflow:runnerReady';

/**
 * Send a single BehaverseTask to Unity and resolve when Unity dispatches the
 * matching `studyflow:taskCompleted` event. The unity-side jslib is responsible
 * for emitting the event with `{ taskId, timelineId, isCompleted }` in detail.
 */
export function runOnUnity(
  unity: UnityInstance,
  payload: BehaverseTaskPayload,
  getUnityWindow: () => UnityWindow | null,
): Promise<TaskCompletion> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; detail?: TaskCompletion } | undefined;
      if (!data || data.type !== COMPLETION_MESSAGE || !data.detail) return;
      if (data.detail.taskId !== payload.task) return;
      if (payload.timeline && data.detail.timelineId && data.detail.timelineId !== payload.timeline) return;
      cleanup();
      resolve(data.detail);
    };

    const onCompleted = (event: Event) => {
      const detail = (event as CustomEvent<TaskCompletion>).detail;
      if (!detail) return;
      if (detail.taskId !== payload.task) return;
      if (payload.timeline && detail.timelineId && detail.timelineId !== payload.timeline) return;
      cleanup();
      resolve(detail);
    };

    const cleanup = () => {
      window.removeEventListener(COMPLETION_EVENT, onCompleted as EventListener);
      window.removeEventListener('message', onMessage);
      getUnityWindow()?.removeEventListener(COMPLETION_EVENT, onCompleted as EventListener);
    };

    window.addEventListener(COMPLETION_EVENT, onCompleted as EventListener);
    window.addEventListener('message', onMessage);
    getUnityWindow()?.addEventListener(COMPLETION_EVENT, onCompleted as EventListener);

    try {
      unity.SendMessage('GameManager', 'RunTask', JSON.stringify(payload));
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

/**
 * Wait for `window.unityInstance` to be available.
 * The WebGL template posts a ready message to the parent window and also
 * dispatches a DOM event as a same-window fallback.
 */
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
      window.removeEventListener('studyflow:unityReady', onReady as EventListener);
      window.clearInterval(pollTimer);
      attachedIframeWindow?.removeEventListener('studyflow:unityReady', onReady as EventListener);
    };

    const onReady = (event: Event) => {
      const detail = (event as CustomEvent<{ unityInstance: UnityInstance }>).detail;
      const instance = detail?.unityInstance ?? resolveFromIframe();
      if (!instance) return;
      cleanup();
      resolve(instance);
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string } | undefined;
      if (data?.type !== READY_MESSAGE) return;
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
        attachedIframeWindow?.removeEventListener('studyflow:unityReady', onReady as EventListener);
        attachedIframeWindow = iframeWindow;
        attachedIframeWindow.addEventListener('studyflow:unityReady', onReady as EventListener, { once: true });
      }
      const instance = resolveFromIframe();
      if (!instance) return;
      cleanup();
      resolve(instance);
    }, 100);

    window.addEventListener('message', onMessage);
    window.addEventListener('studyflow:unityReady', onReady as EventListener);
  });
}

/**
 * Wait for Unity's GameManager to signal it is past the Loading-scene
 * transition and ready to accept RunTask messages. Older Unity builds
 * that don't emit this signal will hit the timeout — callers should treat the
 * timeout as "best effort" and proceed anyway.
 */
export function waitForRunnerReady(
  getIframe: () => HTMLIFrameElement | null,
  timeoutMs = 5_000,
): Promise<'ready' | 'timeout'> {
  return new Promise((resolve) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      window.removeEventListener(RUNNER_READY_EVENT, onReady);
      getIframe()?.contentWindow?.removeEventListener(RUNNER_READY_EVENT, onReady);
    };

    const onReady = () => {
      cleanup();
      resolve('ready');
    };

    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | undefined)?.type === RUNNER_READY_EVENT) onReady();
    };

    const timer = window.setTimeout(() => {
      cleanup();
      resolve('timeout');
    }, timeoutMs);

    window.addEventListener(RUNNER_READY_EVENT, onReady);
    window.addEventListener('message', onMessage);
    getIframe()?.contentWindow?.addEventListener(RUNNER_READY_EVENT, onReady);
  });
}
