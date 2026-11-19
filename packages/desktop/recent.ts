import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type { Served } from './serve';

/* The files `studyflow ui` opened lately, newest first, kept in `$STUDYFLOW_HOME/recent.json` (`~/.studyflow`). The
 * desktop app serves each again at a path of its own and lists them at `/recent.json`, which the modeler's New dialog
 * shows under Recent. Apart from `ui.ts` for the tests, as `serve.ts` is. */

export type RecentFile = { path: string; openedAt: number };

/** As many as the New dialog lists. */
const MAX_RECENT = 5;
/** Where the page reads the list. */
const LIST = '/recent.json';

const store = (): string => path.join(process.env.STUDYFLOW_HOME || path.join(homedir(), '.studyflow'), 'recent.json');

/** The recent files that are still there. A list that does not read is no files. */
export function recentFiles(): RecentFile[] {
  try {
    const kept = JSON.parse(readFileSync(store(), 'utf8')) as RecentFile[];
    return kept.filter((file) => typeof file?.path === 'string' && existsSync(file.path));
  } catch {
    return [];
  }
}

/** Puts `file` first among the recent ones. A home that cannot be written keeps no list, and the file still opens. */
export function rememberRecentFile(file: string, now = Date.now()): RecentFile[] {
  const opened = path.resolve(file);
  const files = [{ path: opened, openedAt: now }, ...recentFiles().filter((other) => other.path !== opened)].slice(0, MAX_RECENT);
  try {
    mkdirSync(path.dirname(store()), { recursive: true });
    writeFileSync(store(), `${JSON.stringify(files, null, 2)}\n`);
  } catch { /* kept for this launch alone */ }
  return files;
}

export function forgetRecentFiles(): void {
  rmSync(store(), { force: true });
}

/**
 * Serves the recent files for one launch, `opened` (the file the launch opens) first among them: `files` gains a path
 * per file, the page's to read and write, and their list (`url`, `name`, `openedAt` each), which a DELETE from the page
 * forgets. Returns the path `opened` is served at, and what the server does when the page says it opened a file again
 * (`serveUi`'s `opened`). A path stays its file's for the whole launch, however the list changes.
 */
export function serveRecent(files: Record<string, Served>, opened?: string): { url?: string; reopened: (file: string) => void } {
  const recent = opened ? rememberRecentFile(opened) : recentFiles();
  const urls = new Map(recent.map((file, index) => [file.path, `/recent/${index}/${encodeURIComponent(path.basename(file.path))}`]));
  const list = (): void => {
    const listed = recentFiles().flatMap(({ path: file, openedAt }) => {
      const url = urls.get(file);
      return url ? [{ url, name: path.basename(file), openedAt }] : [];
    });
    files[LIST] = { type: 'application/json', text: JSON.stringify(listed), forget: () => { forgetRecentFiles(); list(); } };
  };
  for (const [file, url] of urls) files[url] = file;
  list();
  return {
    url: opened && urls.get(path.resolve(opened)),
    reopened: (file) => { rememberRecentFile(file); list(); },
  };
}
