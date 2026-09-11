import { app, BrowserWindow, shell } from 'electron';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { serveUi } from '../desktop/serve.ts';  // Electron's Node strips types: no build step

/* Local only, not a workspace (README.md): the modeler in an Electron window, for screenshots and demos. Not the
 * desktop app (that is `studyflow edit`, packages/desktop), not distributed. Everything the page needs to look like a
 * window of its own is injected from here, so the modeler knows nothing of Electron and this folder can go without a
 * trace. `--dev` (`npm run dev:electron`) runs the modeler's dev server in here, hot reload and all, instead of serving dist/. */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const UI = path.join(ROOT, 'dist');

/** What `studyflow edit` gets from `display-mode: standalone` (assets/css/desktop.css keys off the class). */
const DESKTOP_CLASS = `document.documentElement.classList.add('desktop')`;

/** The inset title bar: the brand starts right of the window buttons (`env(titlebar-area-x)`, the gutter the nav bar
 * centres in grows with it), and the top band drags the window, except the chrome on it (the brand, the nav bar, the
 * inspector: everything `fixed top-2`, assets/css/app.css and the modeler's top-chrome classes). */
const TITLEBAR_CSS = `
  :root { --brand-gutter: calc(3.75rem + env(titlebar-area-x, 0px)); }
  @media (min-width: 1024px) { :root { --brand-gutter: calc(10rem + env(titlebar-area-x, 0px)); } }
  a.fixed.top-2.left-0 { left: env(titlebar-area-x, 0px); }
  body::before { content: ''; position: fixed; inset: 0 0 auto 0; height: 3.5rem; z-index: 40; -webkit-app-region: drag; }
  .fixed.top-2 { -webkit-app-region: no-drag; }
`;

/** Files opened from the OS, served at `/open/<name>` for `?open=` to fetch, as `studyflow edit <file>` does. */
const files = {};
let origin;

function open(file) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#f7f5f0',
    // macOS: the traffic lights inset into the app's own top band, centred on the brand row.
    ...(process.platform === 'darwin' && { titleBarStyle: 'hiddenInset', titleBarOverlay: true, trafficLightPosition: { x: 16, y: 24 } }),
  });
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(DESKTOP_CLASS);
    if (process.platform === 'darwin') win.webContents.insertCSS(TITLEBAR_CSS);
  });
  // Same-origin pop-ups (the runner) stay in the app; anything else is the system browser's.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url.startsWith(origin)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  let query = '';
  if (file) {
    const key = `/open/${encodeURIComponent(path.basename(file))}`;
    files[key] = path.resolve(file);
    query = `?open=${encodeURIComponent(key)}`;
  }
  win.loadURL(`${origin}/app.html${query}`);
}

// Finder double-click (and `open -a Electron file`) can arrive before the server is up.
const pending = [];
app.on('open-file', (event, file) => {
  event.preventDefault();
  if (origin) open(file); else pending.push(file);
});

app.whenReady().then(async () => {
  if (process.argv.includes('--dev')) {
    const { createServer } = await import('vite');  // the repo's, up the tree
    // The opened files, ahead of Vite's own middlewares (which would answer `/open/<name>` with index.html).
    const opened = { name: 'studyflow:opened', configureServer: (s) => { s.middlewares.use((req, res, next) => {
      const file = files[req.url.split('?')[0]];
      return file ? createReadStream(file).pipe(res) : next();
    }); } };
    const server = await createServer({ configFile: path.join(ROOT, 'packages/modeler/vite.config.ts'), root: path.join(ROOT, 'packages/modeler'), plugins: [opened] });
    await server.listen();
    origin = server.resolvedUrls.local[0].replace(/\/$/, '');
    app.on('will-quit', () => { server.close(); });
  } else {
    if (!existsSync(path.join(UI, 'app.html'))) throw new Error('The modeler is not built: `npm run build` at the repo root first.');
    const server = await serveUi(UI, '127.0.0.1', 0, files);
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  const argv = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const toOpen = [...argv, ...pending];
  if (toOpen.length === 0) open();
  for (const file of toOpen) open(file);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) open();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
