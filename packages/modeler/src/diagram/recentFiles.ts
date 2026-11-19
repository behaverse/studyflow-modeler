/**
 * The files opened lately, newest first: what the New dialog offers to open again. They come from two places. A file
 * of the disk's is kept by its handle, in this browser, so only one with the file pickers keeps any. A file
 * `studyflow ui` opened is kept by the desktop app's server (`packages/desktop/recent.ts`), which serves each again
 * and lists them at `recent.json`.
 */
import { withHandleStore } from '@modeler/diagram/handleStore';
import { servedUrl } from '@modeler/diagram/servedFile';

export type RecentFile = {
  name: string;
  /** When it was last linked: opened, saved under its name, or picked back up after a reload. */
  openedAt: number;
} & ({ handle: FileSystemFileHandle } | { url: string });

type KeptHandle = { handle: FileSystemFileHandle; openedAt: number };
type ServedRecent = { url: string; name: string; openedAt: number };

const RECENTS_KEY = 'recent-diagrams';
/** As many as the New dialog lists. */
const MAX_RECENT = 5;

/** One at a time: a change rewrites the whole list, and a read waits for the changes made before it. */
let queue: Promise<unknown> = Promise.resolve();
function queued<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  queue = run.catch(() => {});
  return run;
}

const read = async (): Promise<KeptHandle[]> =>
  (await withHandleStore<KeptHandle[]>('readonly', (store) => store.get(RECENTS_KEY))) ?? [];

/** A list holding a handle the store cannot keep is not written, and the one before it stands. */
const write = (files: KeptHandle[]) => withHandleStore('readwrite', (store) => store.put(files, RECENTS_KEY));

/** Two handles on one file are different objects, so the browser is asked; a handle that cannot say is another file's. */
async function sameFile(a: FileSystemFileHandle, b: FileSystemFileHandle): Promise<boolean> {
  try {
    return await a.isSameEntry(b);
  } catch {
    return false;
  }
}

/** The kept handles but `handle`'s. */
async function others(handle: FileSystemFileHandle): Promise<KeptHandle[]> {
  const kept: KeptHandle[] = [];
  for (const recent of await read()) {
    if (!(await sameFile(handle, recent.handle))) kept.push(recent);
  }
  return kept;
}

const servedList = (): URL => new URL('recent.json', document.baseURI);

/** The server's list, read once a page and kept up from here; nothing where no server keeps one (the web app). */
let served: Promise<ServedRecent[] | undefined> | undefined;
function servedFiles(): Promise<ServedRecent[] | undefined> {
  served ??= fetch(servedList(), { cache: 'no-store' })
    .then(async (response) => (response.ok && response.headers.get('content-type')?.includes('json') ? await response.json() as ServedRecent[] : undefined))
    .catch(() => undefined);
  return served;
}

export function recentFiles(): Promise<RecentFile[]> {
  return queued(async () => {
    const kept = (await read()).map((file) => ({ ...file, name: file.handle.name }));
    return [...kept, ...(await servedFiles() ?? [])].sort((a, b) => b.openedAt - a.openedAt).slice(0, MAX_RECENT);
  });
}

/** Puts a linked file first among the recent ones: in this browser, or by telling the server that serves it. */
export function rememberRecentFile(handle: FileSystemFileHandle): Promise<void> {
  const url = servedUrl(handle);
  return queued(async () => {
    if (!url) {
      await write([{ handle, openedAt: Date.now() }, ...(await others(handle))].slice(0, MAX_RECENT));
      return;
    }
    void fetch(url, { method: 'POST' }).catch(() => {});
    const listed = (await servedFiles())?.find((file) => file.url === url);
    if (listed) listed.openedAt = Date.now();
  });
}

/** Drops a file that is no longer where it was. The server leaves a missing file out by itself the next time. */
export function forgetRecentFile(file: RecentFile): Promise<void> {
  return queued(async () => {
    if ('handle' in file) await write(await others(file.handle));
    else served = Promise.resolve((await servedFiles())?.filter((other) => other.url !== file.url));
  });
}

export function forgetRecentFiles(): Promise<void> {
  return queued(async () => {
    await withHandleStore('readwrite', (store) => store.delete(RECENTS_KEY));
    if (!(await servedFiles())) return;
    void fetch(servedList(), { method: 'DELETE' }).catch(() => {});
    served = Promise.resolve([]);
  });
}
