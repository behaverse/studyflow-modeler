/**
 * Per-browser auto-save of the current diagram. Activated when
 * `settings.diagramAutoSave === 'local'`. Stores formatted BPMN XML at a
 * dedicated localStorage key so it survives reloads but stays out of the
 * settings blob.
 */

import { AUTOSAVE_DIAGRAM_STORAGE_KEY as KEY } from '../constants';

export function loadAutosavedDiagram(): string | undefined {
  if (typeof window === 'undefined' || !window.localStorage) return undefined;
  try {
    return window.localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveAutosavedDiagram(xml: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(KEY, xml);
  } catch {
    // Quota or privacy mode - silently drop. Next save attempts again.
  }
}

export function clearAutosavedDiagram(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignored
  }
}
