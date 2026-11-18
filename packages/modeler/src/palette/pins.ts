/**
 * The tools a person pins: entries of the Add panel (`catalog.ts`) shown in the tools column under the kinds, by id,
 * in the order they were pinned. Each viewer's own, kept with the Settings.
 */

import { useSyncExternalStore } from 'react';
import { getSettings, setSettings, subscribeSettings } from '@modeler/settings/store';

const pinnedIds = (): readonly string[] => getSettings().pinnedTools;

/** The pinned entries' ids, followed as they change. */
export function usePinned(): readonly string[] {
  return useSyncExternalStore(subscribeSettings, pinnedIds, pinnedIds);
}

/** Pin the entry `id` to the tools, or take it off. */
export function togglePin(id: string): void {
  const pinned = getSettings().pinnedTools;
  setSettings({ pinnedTools: pinned.includes(id) ? pinned.filter((other) => other !== id) : [...pinned, id] });
}
