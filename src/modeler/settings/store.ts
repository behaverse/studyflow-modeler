/**
 * Settings persistence layer.
 *
 * Today this is a thin wrapper over `localStorage`. The interface (`load` /
 * `save` / `subscribe`) is intentionally narrow so we can swap the backend
 * (IndexedDB, server-synced profile after login, etc.) without touching the
 * React surface.
 */

import { SCHEMA_NAMES, SETTINGS_STORAGE_KEY as STORAGE_KEY } from '../constants';

const API_KEY_STORAGE_KEY = 'studyflow-modeler:api_key:v1';
const USER_EMAIL_STORAGE_KEY = 'studyflow-modeler:user_email:v1';

export type ThemePreference = 'light' | 'dark' | 'system';
export type DiagramAutoSave = 'off' | 'local';

export type Settings = {
  theme: ThemePreference;
  language: string;
  diagramAutoSave: DiagramAutoSave;
  showGrid: boolean;
  telemetryEnabled: boolean;
  /** Moddle prefixes of extension schemas to load at boot. */
  enabledSchemas: string[];
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  language: 'en',
  diagramAutoSave: 'local',
  showGrid: true,
  telemetryEnabled: false,
  enabledSchemas: [...SCHEMA_NAMES],
};

type Listener = (value: Settings) => void;
const listeners = new Set<Listener>();

function readStorage(): Settings {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeStorage(value: Settings): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Quota or privacy mode - silently drop. Settings stay in memory.
  }
}

let current: Settings = readStorage();

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    current = readStorage();
    listeners.forEach((l) => l(current));
  });
}

export function getSettings(): Settings {
  return current;
}

export function setSettings(partial: Partial<Settings>): Settings {
  current = { ...current, ...partial };
  writeStorage(current);
  listeners.forEach((l) => l(current));
  return current;
}

export function resetSettings(): Settings {
  current = { ...DEFAULT_SETTINGS };
  writeStorage(current);
  listeners.forEach((l) => l(current));
  return current;
}

export function subscribeSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getStorageEstimate(): { keys: number; bytes: number } {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { keys: 0, bytes: 0 };
  }
  let bytes = 0;
  let keys = 0;
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key) continue;
    keys += 1;
    const value = window.localStorage.getItem(key) ?? '';
    bytes += key.length + value.length;
  }
  return { keys, bytes };
}

export function clearAllLocalData(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.clear();
  current = { ...DEFAULT_SETTINGS };
  writeStorage(current);
  listeners.forEach((l) => l(current));
}

// --- API key persistence

export function getStoredApiKey(): string | undefined {
  if (typeof window === 'undefined' || !window.localStorage) return undefined;
  try {
    return window.localStorage.getItem(API_KEY_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setStoredApiKey(key: string | undefined | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (!key || key === 'guest') {
      window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    } else {
      window.localStorage.setItem(API_KEY_STORAGE_KEY, key);
    }
  } catch {
    // Quota or privacy mode - silently drop.
  }
}

export function getStoredUserEmail(): string | undefined {
  if (typeof window === 'undefined' || !window.localStorage) return undefined;
  try {
    return window.localStorage.getItem(USER_EMAIL_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setStoredUserEmail(email: string | undefined | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (!email) {
      window.localStorage.removeItem(USER_EMAIL_STORAGE_KEY);
    } else {
      window.localStorage.setItem(USER_EMAIL_STORAGE_KEY, email);
    }
  } catch {
    // Quota or privacy mode - silently drop.
  }
}
