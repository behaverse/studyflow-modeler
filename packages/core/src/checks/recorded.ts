import type { ModdleElement } from '@core/element/moddle';
import { META_KEY, readState } from '@core/document/state';
import type { Issue } from '@core/checks';
import { stateOf, type RunEvent } from '@core/engine/record';

/** The first path at which two JSON values differ, or undefined when they are the same. */
function differs(a: unknown, b: unknown, at: string): string | undefined {
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) {
      const found = differs((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], at ? `${at}.${key}` : key);
      if (found) return found;
    }
    return undefined;
  }
  return JSON.stringify(a) === JSON.stringify(b) ? undefined : at || 'state';
}

/**
 * An executed copy against its run's record (`events.jsonl`, packages/core/src/engine/record.ts): the counts, passes and
 * properties the file keeps are the ones its events say. The timeline (`_meta.prov`) is left out, since the modeler
 * adds to it when the file is edited and saved.
 */
export function checkRecorded(definitions: ModdleElement, events: readonly RunEvent[]): Issue[] {
  const kept = readState(definitions);
  const recorded = stateOf(events);
  for (const state of [kept, recorded]) delete state[META_KEY]?.prov;
  const at = differs(kept, recorded, '');
  return at ? [{ severity: 'error', message: `the state this file keeps is not what its run's record says, from state.${at} on: it was changed after the run` }] : [];
}
