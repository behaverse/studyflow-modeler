/**
 * The IndexedDB store that keeps file handles across reloads. A handle is structured-cloneable, and nothing else in a
 * browser can hold one: `fileHandle.ts` keeps the linked file here and `recentFiles.ts` the files linked lately, each
 * under a key of its own.
 */

const DB_NAME = 'studyflow-modeler';
const DB_VERSION = 1;
const STORE = 'file-links';

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

/** One request on the store, and its result once the transaction lands; `undefined` when it could not be made. */
export async function withHandleStore<T>(
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
