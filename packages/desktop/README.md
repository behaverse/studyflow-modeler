# @behaverse/studyflow-desktop

The desktop app: the modeler served from this machine, in a window of its own.

```bash
npm run build                                   # the modeler and the runner into dist/, the webapp's build and the desktop app's alike
node packages/cli/dist/studyflow.mjs ui         # open it (or `edit <file>`); as installed: `studyflow ui`
npm run dev:desktop                             # the dev server, with hot reload, opened the same way
```

`studyflow edit` ([edit.ts](edit.ts)) serves `dist/` over [serve.ts](serve.ts) and opens it in a Chromium (Chrome, Chromium, Brave or Edge) in its `--app` mode: no tabs or address bar, its own profile under `~/.studyflow/chromium`, and the command ends when the window closes. Without a Chromium the default browser opens a tab instead. The page tells it is in such a window (`display-mode: standalone`) and styles itself as a window of the system's ([assets/css/desktop.css](../../assets/css/desktop.css)): the system typeface, no text selection on chrome.

Not Electron: a signed, notarized macOS bundle needs a paid Apple Developer ID, and an unsigned one is a worse first run than a Chromium window; the window here costs nothing beyond the CLI tarball and runs the same code as the webapp.
