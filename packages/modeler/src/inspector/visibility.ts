/**
 * Whether the inspector is open, kept with the Settings so it stays as the person left it. Closed (the default), a
 * selected step shows the inline inspector on the canvas (`InlineInspector.tsx`), whose All properties opens this one.
 */

import { useSyncExternalStore } from 'react';
import { getSettings, setSettings, subscribeSettings } from '@modeler/settings/store';

const shown = (): boolean => getSettings().showInspector;

export function useInspectorShown(): boolean {
  return useSyncExternalStore(subscribeSettings, shown, shown);
}

export function showInspector(show: boolean): void {
  setSettings({ showInspector: show });
}

/** How wide the inspector stands over the canvas, 0 while it is closed: what the views' drawer keeps clear of. */
let width = 0;
const widthListeners = new Set<() => void>();

export function publishInspectorWidth(next: number): void {
  if (next === width) return;
  width = next;
  widthListeners.forEach((listener) => listener());
}

export function useInspectorWidth(): number {
  return useSyncExternalStore(
    (listener) => { widthListeners.add(listener); return () => { widthListeners.delete(listener); }; },
    () => width,
    () => width,
  );
}
