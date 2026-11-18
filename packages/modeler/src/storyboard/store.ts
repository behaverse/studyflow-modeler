/** Whether the study shows as its participant's storyboard (`Storyboard.tsx`) rather than as the flow on the canvas. */

import { useSyncExternalStore } from 'react';

let on = false;
const listeners = new Set<() => void>();

export function showStoryboard(next: boolean): void {
  if (next === on) return;
  on = next;
  listeners.forEach((listener) => listener());
}

export function useStoryboard(): boolean {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => on,
    () => on,
  );
}
