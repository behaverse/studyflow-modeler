export const TASK_COMPLETED = 'studyflow:TaskCompleted';
export const AWAITING_RESPONSE = 'studyflow:AwaitingResponse';
export const READY = 'studyflow:Ready';
export const EVENT = 'studyflow:Event';

export type UnityInstance = {
  SendMessage: (gameObjectName: string, methodName: string, value?: string | number) => void;
};

export type UnityWindow = Window & { unityInstance?: UnityInstance };

export type TaskCompletion = {
  TaskId: string;
  TimelineId: string;
  IsCompleted: boolean;
};

/** Keys mirror C# field/JSON conventions (PascalCase, source of truth in Unity). */
export type AwaitingResponseDetail = {
  RequestId: string;
  TrialIndex: number;
  Stimulus: { Value: string };
  ResponseOptions: string[];
  MaxResponseTime: number;  // seconds, matches Unity's MaxResponseTime config
  /** `data:image/png;base64,...` set by Unity when `Bot.IncludeScreenshot = true`. */
  Screenshot?: string;
};

export function subscribeUnityTopic<T>(
  topic: string,
  getUnityWindow: () => UnityWindow | null,
  handler: (detail: T | undefined) => void,
): () => void {
  const onEvent = (e: Event) => handler((e as CustomEvent<T>).detail);
  const onMessage = (e: MessageEvent) => {
    const data = e.data as { type?: string; detail?: T } | undefined;
    if (data?.type !== topic) return;
    handler(data.detail);
  };

  window.addEventListener(topic, onEvent as EventListener);
  window.addEventListener('message', onMessage);
  getUnityWindow()?.addEventListener(topic, onEvent as EventListener);

  return () => {
    window.removeEventListener(topic, onEvent as EventListener);
    window.removeEventListener('message', onMessage);
    getUnityWindow()?.removeEventListener(topic, onEvent as EventListener);
  };
}
