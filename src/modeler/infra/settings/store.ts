import { SCHEMA_NAMES, SETTINGS_STORAGE_KEY as STORAGE_KEY } from '@/modeler/infra/constants';
import { API_KEY_STORAGE_KEY } from '@/core/settings';

const USER_EMAIL_STORAGE_KEY = 'studyflow-modeler:user_email:v1';

type ThemePreference = 'light' | 'dark' | 'system';
type DiagramAutoSave = 'off' | 'local';

export type Settings = {
  theme: ThemePreference;
  language: string;
  diagramAutoSave: DiagramAutoSave;
  showGrid: boolean;
  telemetryEnabled: boolean;
  /** Moddle prefixes of extension schemas to load at boot. */
  enabledSchemas: string[];
};

const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  language: 'en',
  diagramAutoSave: 'local',
  showGrid: true,
  telemetryEnabled: false,
  enabledSchemas: [...SCHEMA_NAMES],
};

const ls: Storage | undefined =
  typeof window !== 'undefined' ? window.localStorage : undefined;

function read(key: string): string | undefined {
  try { return ls?.getItem(key) ?? undefined; } catch { return undefined; }
}

function write(key: string, value: string | undefined): void {
  if (!ls) return;
  try {
    if (value === undefined) ls.removeItem(key);
    else ls.setItem(key, value);
  } catch { /* quota / privacy mode */ }
}

type Listener = (value: Settings) => void;
const listeners = new Set<Listener>();

function loadSettings(): Settings {
  const raw = read(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current: Settings = loadSettings();

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    current = loadSettings();
    listeners.forEach((l) => l(current));
  });
}

function emit(): void {
  write(STORAGE_KEY, JSON.stringify(current));
  listeners.forEach((l) => l(current));
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
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getStorageEstimate(): { keys: number; bytes: number } {
  if (!ls) return { keys: 0, bytes: 0 };
  let bytes = 0;
  let keys = 0;
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i);
    if (!key) continue;
    keys += 1;
    bytes += key.length + (ls.getItem(key) ?? '').length;
  }
  return { keys, bytes };
}

export function clearAllLocalData(): void {
  if (!ls) return;
  try { ls.clear(); } catch { /* quota / privacy mode */ }
  current = { ...DEFAULT_SETTINGS };
  emit();
}

export function getStoredApiKey(): string | undefined {
  return read(API_KEY_STORAGE_KEY);
}

export function setStoredApiKey(key: string | undefined | null): void {
  write(API_KEY_STORAGE_KEY, !key || key === 'guest' ? undefined : key);
}

export function getStoredUserEmail(): string | undefined {
  return read(USER_EMAIL_STORAGE_KEY);
}

export function setStoredUserEmail(email: string | undefined | null): void {
  write(USER_EMAIL_STORAGE_KEY, email || undefined);
}
