const STORAGE_PREFIX = 'studyflow-modeler:';

const k = (name: string) => `${STORAGE_PREFIX}${name}`;

export const STORAGE_KEYS = {
  settings: k('settings'),
  autosaveDiagram: k('autosave-diagram'),
  inspectorWidth: k('inspector-width'),
  llm: k('llm'),
  apiKey: k('api-key'),
  userEmail: k('user-email'),
  recordEvents: k('record-events'),
  diagramHandoffPrefix: k('handoff:'),
} as const;

const OWNED_KEYS: string[] = [
  STORAGE_KEYS.settings,
  STORAGE_KEYS.autosaveDiagram,
  STORAGE_KEYS.inspectorWidth,
  STORAGE_KEYS.llm,
  STORAGE_KEYS.apiKey,
  STORAGE_KEYS.userEmail,
  STORAGE_KEYS.recordEvents,
];

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    // Reading the `localStorage` property itself throws in some privacy configurations.
    return undefined;
  }
}

export type WriteResult = 'ok' | 'unavailable' | 'quota';

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'QuotaExceededError'
    || err.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || (err as { code?: number }).code === 22;
}

function readStored(key: string): string | undefined {
  try {
    return storage()?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeStored(key: string, value: string | undefined): WriteResult {
  const ls = storage();
  if (!ls) return 'unavailable';
  try {
    if (value === undefined) ls.removeItem(key);
    else ls.setItem(key, value);
    return 'ok';
  } catch (err) {
    if (isQuotaError(err)) {
      try { ls.removeItem(key); } catch {}
      return 'quota';
    }
    return 'unavailable';
  }
}

export type Codec<T> = {
  encode(value: T): string;
  decode(raw: string): T | undefined;
};

export const stringCodec: Codec<string> = {
  encode: (value) => value,
  decode: (raw) => raw,
};

export const numberCodec: Codec<number> = {
  encode: (value) => String(Math.round(value)),
  decode: (raw) => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  },
};

export function jsonCodec<T>(): Codec<T> {
  return {
    encode: (value) => JSON.stringify(value),
    decode: (raw) => {
      try { return JSON.parse(raw) as T; } catch { return undefined; }
    },
  };
}

export type Persisted<T> = {
  load(): T;
  peek(): T | undefined;
  save(value: T): WriteResult;
  clear(): WriteResult;
  /** Cross-tab only: the `storage` event never fires in the tab that wrote. */
  subscribe(listener: (value: T) => void): () => void;
  readonly key: string;
};

export function persisted<T>(key: string, codec: Codec<T>, fallback: T): Persisted<T> {
  const peek = (): T | undefined => {
    const raw = readStored(key);
    return raw === undefined ? undefined : codec.decode(raw);
  };

  return {
    key,
    peek,
    load: () => peek() ?? fallback,
    save: (value) => writeStored(key, codec.encode(value)),
    clear: () => writeStored(key, undefined),
    subscribe(listener) {
      if (typeof window === 'undefined') return () => {};
      const onStorage = (event: StorageEvent) => {
        if (event.key !== null && event.key !== key) return;
        listener(peek() ?? fallback);
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    },
  };
}

function listKeys(prefix: string): string[] {
  const ls = storage();
  if (!ls) return [];
  const keys: string[] = [];
  try {
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {}
  return keys;
}

export type DiagramHandoffEnvelope = { createdAt: number; xml: string };

export function diagramHandoffKey(id: string): string {
  return `${STORAGE_KEYS.diagramHandoffPrefix}${id}`;
}

export function readDiagramHandoff(id: string): string | undefined {
  const raw = readStored(diagramHandoffKey(id));
  if (!raw) return undefined;
  try {
    const { xml } = JSON.parse(raw) as DiagramHandoffEnvelope;
    return typeof xml === 'string' && xml ? xml : undefined;
  } catch {
    return undefined;
  }
}

export function clearDiagramHandoff(id: string): void {
  writeStored(diagramHandoffKey(id), undefined);
}

export function takeDiagramHandoff(id: string): string | undefined {
  const xml = readDiagramHandoff(id);
  clearDiagramHandoff(id);
  return xml;
}

const HANDOFF_MAX_AGE_MS = 60 * 60 * 1000;

export function sweepDiagramHandoffs(now = Date.now()): number {
  let swept = 0;
  for (const key of listKeys(STORAGE_KEYS.diagramHandoffPrefix)) {
    const raw = readStored(key);
    let stale = true;
    if (raw) {
      try {
        const { createdAt } = JSON.parse(raw) as DiagramHandoffEnvelope;
        stale = !Number.isFinite(createdAt) || now - createdAt > HANDOFF_MAX_AGE_MS;
      } catch {
        stale = true;
      }
    }
    if (!stale) continue;
    writeStored(key, undefined);
    swept += 1;
  }
  return swept;
}

export type DiagramHandoff = { id: string; result: WriteResult };

export function createDiagramHandoff(xml: string): DiagramHandoff {
  sweepDiagramHandoffs();
  // Truncated because the id travels in a URL the user sees.
  const id = crypto.randomUUID().slice(0, 8);
  const envelope: DiagramHandoffEnvelope = { createdAt: Date.now(), xml };
  return { id, result: writeStored(diagramHandoffKey(id), JSON.stringify(envelope)) };
}

export function storageEstimate(): { keys: number; bytes: number } {
  const ls = storage();
  if (!ls) return { keys: 0, bytes: 0 };
  let keys = 0;
  let bytes = 0;
  try {
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      keys += 1;
      bytes += key.length + (ls.getItem(key) ?? '').length;
    }
  } catch {}
  return { keys, bytes };
}

export function clearOwnedKeys(): void {
  const ls = storage();
  if (!ls) return;
  const doomed = new Set([...OWNED_KEYS, ...listKeys(STORAGE_KEYS.diagramHandoffPrefix)]);
  try {
    for (const key of doomed) ls.removeItem(key);
  } catch {}
}

const LEGACY_KEYS: [legacy: string, current: string][] = [
  ['studyflow-modeler:settings:v1', STORAGE_KEYS.settings],
  ['studyflow-modeler:autosave-diagram:v1', STORAGE_KEYS.autosaveDiagram],
  ['studyflow-modeler:inspector-width:v1', STORAGE_KEYS.inspectorWidth],
  ['studyflow-modeler:llm:v1', STORAGE_KEYS.llm],
  ['studyflow-modeler:api_key:v1', STORAGE_KEYS.apiKey],
  ['studyflow-modeler:user_email:v1', STORAGE_KEYS.userEmail],
  ['studyflow-modeler:should_record_events:v1', STORAGE_KEYS.recordEvents],
];

export function migrateLegacyKeys(): void {
  const ls = storage();
  if (!ls) return;
  for (const [legacy, current] of LEGACY_KEYS) {
    try {
      const value = ls.getItem(legacy);
      if (value === null) continue;
      if (ls.getItem(current) === null) ls.setItem(current, value);
      ls.removeItem(legacy);
    } catch {}
  }
}
