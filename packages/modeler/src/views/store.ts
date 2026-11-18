/**
 * Which view the drawer under the canvas shows, if any (`views/Drawer.tsx`): the schedule, the checklists, the
 * provenance. One at a time; closing it remembers the last, which the composer's toggle opens again. Maximized, the
 * drawer stands as a dialog over the app. A provenance opened on an element (the `p` key) shows only its records until
 * the filter is cleared.
 */

import { useSyncExternalStore } from 'react';

export type ViewId = 'schedule' | 'checklist' | 'provenance';

export const VIEWS: readonly { id: ViewId; label: string }[] = [
  { id: 'schedule', label: 'Schedule' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'provenance', label: 'Provenance' },
];

type State = { open: ViewId | null; last: ViewId; maximized: boolean; scope?: string };

let state: State = { open: null, last: 'schedule', maximized: false };
const listeners = new Set<() => void>();

function set(next: State): void {
  state = next;
  listeners.forEach((listener) => listener());
}

/** Open `id`; `scope` filters a provenance to one element's records. */
export function openView(id: ViewId, scope?: string): void {
  set({ ...state, open: id, last: id, scope });
}

/** The drawer as a dialog over the app, or back under the canvas. */
export function maximizeViews(maximized: boolean): void {
  set({ ...state, maximized });
}

export function closeView(): void {
  set({ ...state, open: null, scope: undefined });
}

/** The composer's toggle: the last view, or none. */
export function toggleViews(): void {
  if (state.open) closeView();
  else openView(state.last);
}

/** The provenance filter let go: every record shows again. */
export function clearViewScope(): void {
  set({ ...state, scope: undefined });
}

export function useViews(): State {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => state,
    () => state,
  );
}
