import type { BehaverseTaskPayload } from './types';

export type UnityInstance = {
  SendMessage: (gameObjectName: string, methodName: string, value?: string | number) => void;
};

export type TaskCompletion = {
  taskId: string;
  timelineId: string;
  isCompleted: boolean;
};

const COMPLETION_EVENT = 'studyflow:taskCompleted';

/**
 * Send a single BehaverseTask to Unity and resolve when Unity dispatches the
 * matching `studyflow:taskCompleted` event. The unity-side jslib is responsible
 * for emitting the event with `{ taskId, timelineId, isCompleted }` in detail.
 */
export function runOnUnity(
  unity: UnityInstance,
  payload: BehaverseTaskPayload,
): Promise<TaskCompletion> {
  return new Promise((resolve, reject) => {
    const onCompleted = (event: Event) => {
      const detail = (event as CustomEvent<TaskCompletion>).detail;
      if (!detail) return;
      if (detail.taskId !== payload.task) return;
      if (payload.timeline && detail.timelineId && detail.timelineId !== payload.timeline) return;
      window.removeEventListener(COMPLETION_EVENT, onCompleted as EventListener);
      resolve(detail);
    };

    window.addEventListener(COMPLETION_EVENT, onCompleted as EventListener);

    try {
      unity.SendMessage('GameManager', 'RunTaskActivity', JSON.stringify({
        task: payload.task,
        timeline: payload.timeline ?? '',
        overrides: payload.overrides,
        inlineConfig: payload.inlineConfig,
      }));
    } catch (err) {
      window.removeEventListener(COMPLETION_EVENT, onCompleted as EventListener);
      reject(err);
    }
  });
}

/**
 * Wait for `window.unityInstance` to be available (set by the WebGL template's
 * `studyflow:unityReady` event).
 */
export function waitForUnity(timeoutMs = 60_000): Promise<UnityInstance> {
  return new Promise((resolve, reject) => {
    const existing = (window as any).unityInstance as UnityInstance | undefined;
    if (existing) {
      resolve(existing);
      return;
    }
    const timer = window.setTimeout(() => {
      window.removeEventListener('studyflow:unityReady', onReady as EventListener);
      reject(new Error('Timed out waiting for Unity to load.'));
    }, timeoutMs);
    const onReady = (event: Event) => {
      window.clearTimeout(timer);
      window.removeEventListener('studyflow:unityReady', onReady as EventListener);
      const detail = (event as CustomEvent<{ unityInstance: UnityInstance }>).detail;
      resolve(detail?.unityInstance ?? ((window as any).unityInstance as UnityInstance));
    };
    window.addEventListener('studyflow:unityReady', onReady as EventListener);
  });
}
