/**
 * The link between the canvas and one file on disk.
 *
 * `showOpenFilePicker({ mode: 'readwrite' })` makes the pick itself the write grant: every later
 * write through the handle it returns lands in that same file, silently, for as long as the page
 * lives. Nothing here can reach a path the user did not hand over — that is the whole permission
 * model, and there is no way around it.
 *
 * Chromium only. Firefox, Safari, and every mobile browser ship no picker, so each entry point
 * reports its absence and the caller falls back to `<input type=file>` and a download.
 */
import { notify } from '@modeler/app/noticeStore';
import {
  formatAccept,
  getExportFormat,
  OPENABLE_ACCEPT,
  importableFormatFor,
  type ExportFormat,
  type ExportFormatId,
} from '@modeler/export/formats';

export type LinkState =
  /** What is on disk is what is on screen. */
  | 'clean'
  /** Edited since the last write. */
  | 'dirty'
  | 'saving'
  /** Something else wrote the file; auto-save stands down until the user saves explicitly. */
  | 'conflict'
  /** Link restored from an earlier session: writing needs the user to re-grant permission. */
  | 'blocked'
  | 'error';

export type LinkedFile = {
  handle: FileSystemFileHandle;
  name: string;
  /** How to encode the diagram when writing back, taken from the extension it was opened as. */
  format: ExportFormat;
  /** The file's `lastModified` as of our last read or write; `0` until the first write lands. */
  seenModified: number;
};

export type LinkSnapshot = {
  file: LinkedFile | null;
  state: LinkState;
  /** Set alongside `error` and `conflict`, for the tooltip on the status chip. */
  message?: string;
};

const NO_LINK: LinkSnapshot = { file: null, state: 'clean' };

let snapshot: LinkSnapshot = NO_LINK;
const listeners = new Set<() => void>();

/** Identity changes only when something changed, which is what `useSyncExternalStore` requires. */
export function getLink(): LinkSnapshot {
  return snapshot;
}

/** Selector for consumers that only care which file is linked, not what state it is in. */
export const getLinkedFileName = (): string | undefined => snapshot.file?.name;

export function subscribeLink(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function setSnapshot(next: LinkSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function setState(state: LinkState, message?: string): void {
  if (!snapshot.file) return;
  if (snapshot.state === state && snapshot.message === message) return;
  setSnapshot({ ...snapshot, state, message });
}

/**
 * Edits are counted, not flagged, so a write knows which edit it captured. An edit landing while
 * a write is in flight would otherwise be marked saved by that write and never reach the file.
 */
let editSeq = 0;
let writtenSeq = 0;
/** The edit the in-flight write captured, taken when it started rather than when it lands. */
let capturedSeq = 0;

export function markDirty(): void {
  editSeq += 1;
  setState('dirty');
}

export const markSaving = (): void => {
  capturedSeq = editSeq;
  setState('saving');
};

export const markBlocked = (): void => setState('blocked');
export const markConflict = (message: string): void => setState('conflict', message);
export const markError = (message: string): void => setState('error', message);

export function markSaved(seenModified: number): void {
  writtenSeq = capturedSeq;
  if (!snapshot.file) return;
  // Anything edited since the write started is still unsaved, however the write itself went.
  setSnapshot({ file: { ...snapshot.file, seenModified }, state: settledState() });
}

/** Whether the file is behind the canvas. Auto-save asks before it writes anything. */
export const hasUnsavedEdits = (): boolean => editSeq !== writtenSeq;

const settledState = (): LinkState => (hasUnsavedEdits() ? 'dirty' : 'clean');

/**
 * The canvas now holds exactly what was read from a file. Called at the end of an open, not when
 * the file is linked a moment later: an edit in between is a real unsaved edit, and marking it
 * saved at link time is how it would go missing.
 */
export function markOpened(): void {
  writtenSeq = editSeq;
}

export function linkFile(
  handle: FileSystemFileHandle,
  format: ExportFormat,
  { seenModified = 0, state = 'dirty', message }: { seenModified?: number; state?: LinkState; message?: string } = {},
): LinkedFile {
  const file: LinkedFile = { handle, name: handle.name, format, seenModified };
  // Clean is a claim about the canvas, so it only holds while nothing is waiting to be written.
  setSnapshot({ file, state: state === 'clean' ? settledState() : state, message });
  void rememberLink();
  return file;
}

export function unlinkFile(): void {
  setSnapshot(NO_LINK);
  void forgetLink();
}

/** Links the file an open just read, so the next save writes back into it. */
export function linkOpenedFile(handle: FileSystemFileHandle, file: File): void {
  const format = importableFormatFor(handle.name);
  // An unrecognised extension has no encoder to write it back with; leave the diagram unlinked.
  if (!format) return;
  linkFile(handle, format, { seenModified: file.lastModified, state: 'clean' });
}

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined'
    && typeof window.showOpenFilePicker === 'function'
    && typeof window.showSaveFilePicker === 'function'
    // The pickers are blocked in a cross-origin frame, where they reject rather than open.
    && window.self === window.top;
}

/** The user closing the picker is not a failure; it just yields nothing. */
function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export type PickAccept = {
  accept: Record<string, string[]>;
  description?: string;
  /** Stable across picks so Chrome reopens in the directory the user last used. */
  id?: string;
};

/** Callers gate on `supportsFileSystemAccess` first, so `undefined` back means the user cancelled. */
export async function pickFileToOpen(
  accept: PickAccept,
  mode: 'read' | 'readwrite',
): Promise<FileSystemFileHandle | undefined> {
  try {
    const [handle] = await window.showOpenFilePicker!({
      multiple: false,
      // Asking for write here is what buys silent saves later; asking afterwards costs a prompt.
      mode,
      id: accept.id,
      types: [{ description: accept.description, accept: accept.accept }],
    });
    return handle;
  } catch (err) {
    if (isAbort(err)) return undefined;
    throw err;
  }
}

export async function pickSaveTarget(
  suggestedName: string,
  format: ExportFormat,
): Promise<FileSystemFileHandle | undefined> {
  try {
    return await window.showSaveFilePicker!({
      suggestedName,
      id: 'studyflow-diagram',
      types: [{ description: format.label, accept: formatAccept(format) }],
    });
  } catch (err) {
    if (isAbort(err)) return undefined;
    throw err;
  }
}

/** What the open picker offers, read from the format catalog so a new format cannot drift from it. */
export const DIAGRAM_OPEN_ACCEPT: PickAccept = {
  accept: OPENABLE_ACCEPT,
  description: 'Studyflow diagram',
  id: 'studyflow-diagram',
};

export async function ensureWritePermission(
  handle: FileSystemFileHandle,
  { request }: { request: boolean },
): Promise<PermissionState> {
  const descriptor: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
  // No `queryPermission` means no permission layer to satisfy, as in a test double.
  const current = (await handle.queryPermission?.(descriptor)) ?? 'granted';
  if (current === 'granted' || !request) return current;
  return (await handle.requestPermission?.(descriptor)) ?? 'denied';
}

/**
 * Whether the file moved under us since we last read or wrote it. The one rule that decides
 * whether auto-save stands down, so it lives next to the `seenModified` it compares against.
 */
export function changedOnDisk(file: LinkedFile, onDisk?: File): boolean {
  // Before the first write there is no known timestamp to compare against; nothing is a conflict.
  if (file.seenModified === 0 || !onDisk) return false;
  return onDisk.lastModified !== file.seenModified;
}

/** Unreadable now: let a later write produce the real error rather than guessing at one here. */
export const readFile = (handle: FileSystemFileHandle): Promise<File | undefined> =>
  handle.getFile().catch(() => undefined);

export const changedElsewhere = (name: string): string =>
  `${name} changed on disk since this browser last wrote it. Saving replaces what is there now.`;

let writeChain: Promise<unknown> = Promise.resolve();

/**
 * Overwrites the file and reports its new `lastModified`.
 *
 * Writes are chained because two writables open on one handle at once throws, and a debounced
 * auto-save can easily fire again while the previous write is still committing.
 */
export function writeToFile(handle: FileSystemFileHandle, payload: BlobPart): Promise<number> {
  const run = writeChain.then(async () => {
    const writable = await handle.createWritable();
    try {
      await writable.write(payload);
    } catch (err) {
      // Without the abort the file stays locked by a writable nobody holds a reference to.
      await writable.abort?.().catch(() => {});
      throw err;
    }
    await writable.close();
    return (await handle.getFile()).lastModified;
  });
  writeChain = run.catch(() => {});
  return run;
}

/* --- Remembering the link across reloads -------------------------------------------------- */

const DB_NAME = 'studyflow-modeler';
const DB_VERSION = 1;
const STORE = 'file-links';
const LINK_KEY = 'current-diagram';

type StoredLink = {
  handle: FileSystemFileHandle;
  formatId: ExportFormatId;
  seenModified: number;
};

/** Resolves `undefined` rather than rejecting: a browser that refuses IndexedDB just forgets. */
function openDb(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(undefined);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
    request.onblocked = () => resolve(undefined);
  });
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  try {
    return await new Promise<T | undefined>((resolve) => {
      try {
        const tx = db.transaction(STORE, mode);
        const request = body(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => resolve(undefined);
        tx.onabort = () => resolve(undefined);
      } catch {
        // A value the structured clone cannot carry throws here, synchronously.
        resolve(undefined);
      }
    });
  } finally {
    db.close();
  }
}

async function rememberLink(): Promise<void> {
  const { file } = snapshot;
  if (!file) return;
  const stored: StoredLink = {
    handle: file.handle,
    formatId: file.format.id,
    seenModified: file.seenModified,
  };
  // A handle is structured-cloneable, which is the only reason this survives a reload at all.
  await runTransaction('readwrite', (store) => store.put(stored, LINK_KEY));
}

async function forgetLink(): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(LINK_KEY));
}

/**
 * Restores the link after a reload, without touching the diagram on screen.
 *
 * Permission resets to `prompt` on every fresh load unless the app is installed, so the usual
 * outcome is a `blocked` link the user reconnects with one click. Even when permission survived,
 * a file that changed underneath us is a conflict: the canvas was restored from browser storage
 * and may be older than what is on disk.
 */
export async function restoreLink(): Promise<void> {
  if (!supportsFileSystemAccess()) return;
  const stored = await runTransaction<StoredLink>('readonly', (store) => store.get(LINK_KEY));
  if (!stored?.handle) return;

  let format: ExportFormat;
  try {
    format = getExportFormat(stored.formatId);
  } catch {
    await forgetLink();
    return;
  }

  const permission = await ensureWritePermission(stored.handle, { request: false });
  if (permission === 'denied') {
    await forgetLink();
    return;
  }
  if (permission !== 'granted') {
    linkFile(stored.handle, format, { seenModified: stored.seenModified, state: 'blocked' });
    return;
  }

  const onDisk = await readFile(stored.handle);
  if (!onDisk) {
    await forgetLink();
    return;
  }
  const moved = changedOnDisk({ ...stored, name: stored.handle.name, format }, onDisk);
  linkFile(stored.handle, format, {
    seenModified: stored.seenModified,
    state: moved ? 'conflict' : 'clean',
    message: moved ? changedElsewhere(stored.handle.name) : undefined,
  });
}

/** Re-grants write permission on a restored link. Must run inside a click, or Chrome says no. */
export async function reconnectLink(): Promise<boolean> {
  const { file } = snapshot;
  if (!file) return false;
  const permission = await ensureWritePermission(file.handle, { request: true });
  if (permission !== 'granted') {
    notify('error', `The browser did not grant permission to write ${file.name}. Save it somewhere new instead.`);
    return false;
  }
  const moved = changedOnDisk(file, await readFile(file.handle));
  setState(moved ? 'conflict' : 'dirty', moved ? changedElsewhere(file.name) : undefined);
  return true;
}
