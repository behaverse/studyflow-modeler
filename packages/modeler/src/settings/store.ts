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
  /** Whether a drag lands on the 10-unit grid; alignment snapping wins inside its own threshold either way. */
  snapToGrid: boolean;
  /** Moddle prefixes of the shipped schemas the user turned off; a required one is never among them. */
  disabledSchemas: string[];
};

const DEFAULT_SETTINGS: Settings = {
  diagramAutoSave: 'local',
  autoSaveToFile: true,
  snapToGrid: true,
  disabledSchemas: [],
};

/** The settings the user changed: one left at its default is not stored, so a later default reaches whoever never
 * changed it. */
function changedSettings(settings: Settings): Partial<Settings> {
  return Object.fromEntries(Object.entries(DEFAULT_SETTINGS)
    .filter(([key, fallback]) => JSON.stringify(settings[key as keyof Settings]) !== JSON.stringify(fallback))
    .map(([key]) => [key, settings[key as keyof Settings]]));
}

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
  lastWrite = settingsStore.save(changedSettings(current));
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

/** Who works here, as a sign-in found out: the provenance this app writes names them. */
const userEmailStore = persisted<string>(STORAGE_KEYS.userEmail, stringCodec, '');

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

