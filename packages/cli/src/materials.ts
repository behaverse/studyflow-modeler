import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MaterialContent } from '@core/checks/materials';

/** How long an address may take to answer before its material is left unchecked. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * How `validate` and `run` read a material a study registers by its content (`@core/checks/materials`): a path from the
 * study file's folder, as a run stages its inputs, or an absolute one; a `file:` URL; an http(s) address, fetched. A
 * file that is not there is an error. An address that does not answer, and a scheme this reads no file by (`s3://`, a
 * DOI), leave the material unchecked, with a warning, since another machine, or the next try, may read it.
 */
export function materialReader(study: string): (uri: string) => Promise<MaterialContent> {
  return async (uri) => {
    if (/^https?:\/\//i.test(uri)) {
      try {
        const response = await fetch(uri, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!response.ok) return { unread: `it answered HTTP ${response.status}, so its content was not checked`, severity: 'warning' };
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        return { unread: `it could not be fetched (${(error as Error).message}), so its content was not checked`, severity: 'warning' };
      }
    }
    const isFileUrl = /^file:/i.test(uri);
    if (!isFileUrl && /^[a-z][a-z0-9+.-]+:/i.test(uri)) {
      return { unread: 'this machine reads only files and http(s) addresses, so its content was not checked', severity: 'warning' };
    }
    const file = isFileUrl ? fileURLToPath(uri) : path.resolve(path.dirname(study), uri);
    try {
      return new Uint8Array(await readFile(file));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {
        unread: code === 'ENOENT' ? `there is no ${file}` : code === 'EISDIR' ? `${file} is a folder, where a digest registers one file` : (error as Error).message,
        severity: 'error',
      };
    }
  };
}
