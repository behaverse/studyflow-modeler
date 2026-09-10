import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { serveUi } from './serve';

/* `studyflow edit [file]` (`studyflow ui`: the same, without a file): the desktop app. Serve the modeler (`npm run build`,
 * the same `dist/` the webapp is) from this machine and open it in a window of its own. The page knows it is in one
 * (`display-mode: standalone`) and styles itself as a window of the system's: assets/css/desktop.css. */

export type UiOptions = {
  port?: number;
  host?: string;
  /** commander's `--no-open` sets this false. */
  open?: boolean;
};

/** Where the desktop app can be, best first: the repo's `dist/` when this is the bundle in a checkout,
 * Homebrew's `libexec/ui` next to `bin/studyflow`, then beside the binary (the release tarball as unpacked). */
function uiDirCandidates(): string[] {
  const candidates: string[] = [];
  if (import.meta.url.startsWith('file:')) {
    candidates.push(fileURLToPath(new URL('../../../dist', import.meta.url)));
  }
  try {
    const binDir = path.dirname(realpathSync(process.execPath));
    candidates.push(path.join(binDir, '..', 'libexec', 'ui'), path.join(binDir, 'ui'));
  } catch { /* execPath is unreadable on some sandboxes; the other candidates still stand */ }
  return candidates;
}

export function uiDir(): string {
  const found = uiDirCandidates().find((dir) => existsSync(path.join(dir, 'app.html')));
  if (found) return found;
  throw new Error('The desktop app is not built. From the repo: `npm run build` (writes dist/), then `studyflow edit` again.');
}

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

/** Serve the modeler and open it, on `file` (served at `/open/<name>`, which `/app?open=` fetches) when given. */
export async function edit(file: string | undefined, options: UiOptions = {}): Promise<void> {
  const root = uiDir();
  if (file && !existsSync(file)) throw new Error(`No such file: ${file}`);
  const files = file ? { [`/open/${encodeURIComponent(path.basename(file))}`]: path.resolve(file) } : {};
  const host = options.host ?? '127.0.0.1';
  const server = await serveUi(root, host, options.port ?? 4174, files);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  const [openPath] = Object.keys(files);
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${port}/app${openPath ? `?open=${encodeURIComponent(openPath)}` : ''}`;
  console.log(`Desktop app at ${url} (serving ${root}; Ctrl-C to stop)`);
  if (options.open === false) return;  // the listening server keeps the process alive; Ctrl-C ends it
  await openWindow(url);
  server.close();
  server.closeAllConnections();
}
