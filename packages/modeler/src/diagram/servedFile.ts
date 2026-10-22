/**
 * The file `studyflow edit <file>` opened, as the link sees it: the few `FileSystemFileHandle` methods saving uses,
 * over the URL the desktop app serves it at (`packages/desktop/serve.ts`), which takes a PUT of the new bytes.
 *
 * So Save writes back into that file, under its own name and in its own format, as it does for a picked file.
 */

/** `packages/desktop/serve.ts`'s `MODIFIED_HEADER`: the file's mtime, sent only for a file it serves from disk. */
const MODIFIED_HEADER = 'x-studyflow-modified';

/** The file a response carries, named `name`, or `undefined` when it is not one the server writes back. */
export async function servedFile(response: Response, name: string): Promise<File | undefined> {
  const modified = response.headers.get(MODIFIED_HEADER);
  if (modified === null) return undefined;
  return new File([await response.blob()], name, { lastModified: Number(modified) });
}

async function failure(response: Response): Promise<Error> {
  return new Error(`${response.status} ${(await response.text()) || response.statusText}`);
}

export function servedFileHandle(url: string, name: string): FileSystemFileHandle {
  const getFile = async (): Promise<File> => {
    const response = await fetch(url, { cache: 'no-store' });
    const file = response.ok ? await servedFile(response, name) : undefined;
    if (!file) throw await failure(response);
    return file;
  };
  const createWritable = async () => {
    const parts: BlobPart[] = [];
    return {
      write: async (part: BlobPart) => { parts.push(part); },
      close: async () => {
        const response = await fetch(url, { method: 'PUT', body: new Blob(parts) });
        if (!response.ok) throw await failure(response);
      },
      abort: async () => { parts.length = 0; },
    };
  };
  // No `queryPermission`: the server is the permission, and `ensureWritePermission` reads its absence as granted.
  return { kind: 'file', name, getFile, createWritable } as unknown as FileSystemFileHandle;
}
