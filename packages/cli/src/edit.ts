import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { serveUi } from '@cli/serve';

/* `studyflow edit [file]` (`studyflow ui`: the same, without a file): the desktop app. Serve the modeler built for it (`npm run build -- --mode desktop`, the static `dist/` of the
 * modeler and the browser runner) from this machine and open it. */

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
  throw new Error('The desktop app is not built. From the repo: `npm run build -- --mode desktop` (writes dist/), then `studyflow edit` again.');
}

function openBrowser(url: string): void {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
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
  if (options.open !== false) openBrowser(url);
  // The listening server keeps the process alive; Ctrl-C ends it.
}
