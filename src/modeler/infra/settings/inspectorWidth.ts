import { INSPECTOR_WIDTH_STORAGE_KEY as KEY } from '@/modeler/infra/constants';

/** The width the user last dragged the inspector to. Kept out of `settings`
 *  because it is a gesture's result, not a preference anyone sets by hand. */

const ls: Storage | undefined =
  typeof window !== 'undefined' ? window.localStorage : undefined;

export function loadInspectorWidth(): number | undefined {
  try {
    const stored = Number(ls?.getItem(KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : undefined;
  } catch {
    return undefined;
  }
}

export function saveInspectorWidth(width: number): void {
  try { ls?.setItem(KEY, String(Math.round(width))); } catch { /* quota / privacy mode */ }
}
