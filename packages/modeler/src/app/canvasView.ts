/** Which skill's view stands in for the canvas (`CanvasView`, `skillModules.ts`), by its id; none shows the flow. */

import { useSyncExternalStore } from 'react';

let shown: string | undefined;
const listeners = new Set<() => void>();

export function showCanvasView(id: string | undefined): void {
  if (id === shown) return;
  shown = id;
  listeners.forEach((listener) => listener());
}

export function useCanvasView(): string | undefined {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => shown,
    () => shown,
  );
}
