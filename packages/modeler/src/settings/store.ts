import { SCHEMA_NAMES } from '@core/notation/loader';
import {
  clearOwnedKeys,
  jsonCodec,
  numberCodec,
  persisted,
  STORAGE_KEYS,
  storageEstimate,
  stringCodec,
  type WriteResult,
} from '@core/storage';
import { notify } from '@modeler/app/noticeStore';
import { unlinkFile } from '@modeler/diagram/fileHandle';

type DiagramAutoSave = 'off' | 'local';

export type Settings = {
  diagramAutoSave: DiagramAutoSave;
  /** Write edits straight back into the linked file. Does nothing until a file is linked. */
  autoSaveToFile: boolean;
  showGrid: boolean;
  /** Moddle prefixes of extension schemas to load at boot. */
  enabledSchemas: string[];
};

const DEFAULT_SETTINGS: Settings = {
  diagramAutoSave: 'local',
  autoSaveToFile: true,
  showGrid: true,
  enabledSchemas: [...SCHEMA_NAMES],
};

const settingsStore = persisted<Partial<Settings>>(
  STORAGE_KEYS.settings,
  jsonCodec<Partial<Settings>>(),
  {},
);

type Listener = (value: Settings) => void;
const settingsListeners = new Set<Listener>();

function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...settingsStore.load() };
}

let current: Settings = loadSettings();

let lastWrite: WriteResult = 'ok';
let warned = false;

settingsStore.subscribe(() => {
  current = loadSettings();
  settingsListeners.forEach((l) => l(current));
});

function emit(): void {
  lastWrite = settingsStore.save(current);
  if (lastWrite !== 'ok' && !warned) {
    warned = true;
    notify('warning',
      'Settings could not be saved: ' +
      (lastWrite === 'quota'
        ? 'browser storage is full. Free space from Settings > Privacy > Clear all local data.'
        : 'this browser blocks local storage. Allow it for this site to keep these settings. Until then, changes apply to this session only.'));
  }
  if (lastWrite === 'ok') warned = false;
  // Listeners are still notified: the control the user just clicked has to reflect the click.
  settingsListeners.forEach((l) => l(current));
}

export function getSettings(): Settings {
  return current;
}

export function setSettings(partial: Partial<Settings>): Settings {
  current = { ...current, ...partial };
  emit();
  return current;
}

export function resetSettings(): Settings {
  current = { ...DEFAULT_SETTINGS };
  emit();
  return current;
}

export function subscribeSettings(listener: Listener): () => void {
  settingsListeners.add(listener);
  return () => { settingsListeners.delete(listener); };
}

export function getStorageEstimate(): { keys: number; bytes: number } {
  return storageEstimate();
}

export function clearAllLocalData(): void {
  clearOwnedKeys();
  // The linked file's handle lives in IndexedDB, which `clearOwnedKeys` cannot reach.
  unlinkFile();
  current = { ...DEFAULT_SETTINGS };
  emit();
}

const apiKeyStore = persisted<string>(STORAGE_KEYS.apiKey, stringCodec, '');
const userEmailStore = persisted<string>(STORAGE_KEYS.userEmail, stringCodec, '');

export function getStoredApiKey(): string | undefined {
  return apiKeyStore.peek();
}

export function setStoredApiKey(key: string | undefined | null): void {
  if (!key || key === 'guest') apiKeyStore.clear();
  else apiKeyStore.save(key);
}

export function getStoredUserEmail(): string | undefined {
  return userEmailStore.peek();
}

export function setStoredUserEmail(email: string | undefined | null): void {
  if (!email) userEmailStore.clear();
  else userEmailStore.save(email);
}

const autosaveStore = persisted<string>(STORAGE_KEYS.autosaveDiagram, stringCodec, '');

const warnedFor = new Set<'quota' | 'unavailable' | 'failed'>();

export function loadAutosavedDiagram(): string | undefined {
  return autosaveStore.peek() || undefined;
}

export function saveAutosavedDiagram(xml: string): WriteResult {
  const result = autosaveStore.save(xml);
  if (result !== 'ok') reportOnce(result === 'quota' ? 'quota' : 'unavailable');
  return result;
}

export function reportAutosaveFailure(err: unknown): void {
  if (warnedFor.has('failed')) return;
  warnedFor.add('failed');
  console.warn('Auto-save failed: the diagram could not be serialized.', err);
  notify('warning',
    'Auto-save failed: the diagram could not be written, so no copy was stored. '
    + 'Save it now if you need to keep it.');
}

function reportOnce(kind: 'quota' | 'unavailable'): void {
  if (warnedFor.has(kind)) return;
  warnedFor.add(kind);
  notify('warning',
    kind === 'quota'
      ? 'Auto-save could not store the diagram: browser storage is full. The stale entry was '
        + 'cleared so a truncated diagram is never restored. Export the diagram to keep it.'
      : 'Auto-save could not store the diagram: this browser does not provide local storage. '
        + 'Save the diagram to keep it.');
}

export function clearAutosavedDiagram(): void {
  autosaveStore.clear();
  warnedFor.clear();
}

const widthStore = persisted<number>(STORAGE_KEYS.inspectorWidth, numberCodec, 0);

export function loadInspectorWidth(): number | undefined {
  return widthStore.peek();
}

export function saveInspectorWidth(width: number): void {
  widthStore.save(width);
}


export { readDiagramHandoff, clearDiagramHandoff, takeDiagramHandoff, createDiagramHandoff } from '@core/storage';
