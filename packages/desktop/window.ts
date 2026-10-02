import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/* The desktop app's window: what `studyflow edit` opens the modeler in, and `npm run dev:desktop` the dev server. */

/** A Chromium on this machine, if any: the app runs in its `--app` mode (a window of its own, no tabs or address
 * bar), and Chromium is the one engine with the File System Access API that saving back to disk needs. */
function chromium(): string | undefined {
  if (process.platform === 'darwin') {
    return ['Google Chrome', 'Chromium', 'Brave Browser', 'Microsoft Edge']
      .map((app) => `/Applications/${app}.app/Contents/MacOS/${app}`)
      .find(existsSync);
  }
  if (process.platform === 'linux') {
    const dirs = (process.env.PATH ?? '').split(path.delimiter);
    return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'brave-browser', 'microsoft-edge']
      .flatMap((name) => dirs.map((dir) => path.join(dir, name)))
      .find(existsSync);
  }
  return undefined;
}

/** Open `url` as a window of its own when a Chromium is around, else in the default browser. The window is the
 * app's lifetime: resolves when it closes (never, in the browser case). Also what `npm run dev:desktop` opens. */
export function openWindow(url: string): Promise<void> {
  const app = chromium();
  if (!app) {
    const [command, args] = process.platform === 'darwin' ? ['open', [url]]
      : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
    spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    return new Promise(() => {});
  }
  // Its own profile: the app's file grants and drafts, apart from the user's browsing; also its own process, so
  // closing the window ends this one.
  // ponytail: one profile; a second `edit --port N` hands its window to the running Chromium and returns at once.
  const child = spawn(app, [
    `--app=${url}`,
    `--user-data-dir=${path.join(homedir(), '.studyflow', 'chromium')}`,
    '--no-first-run',
    '--no-default-browser-check',
  ], { stdio: 'ignore' });
  return new Promise((resolve) => child.on('exit', () => resolve()).on('error', () => resolve()));
}
