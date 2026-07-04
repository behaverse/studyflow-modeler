import { AUTOSAVE_DIAGRAM_STORAGE_KEY as KEY } from '@/modeler/infra/constants';

const ls: Storage | undefined =
  typeof window !== 'undefined' ? window.localStorage : undefined;

export function loadAutosavedDiagram(): string | undefined {
  try { return ls?.getItem(KEY) ?? undefined; } catch { return undefined; }
}

export function saveAutosavedDiagram(xml: string): void {
  try { ls?.setItem(KEY, xml); } catch { /* quota / privacy mode */ }
}

export function clearAutosavedDiagram(): void {
  try { ls?.removeItem(KEY); } catch { /* quota / privacy mode */ }
}
