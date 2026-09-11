# @behaverse/studyflow-desktop

The desktop app: `studyflow edit <file>` (and `studyflow ui`) serve the webapp's `dist/` from this machine and open it in a Chromium app window (Chrome, Chromium, Brave, or Edge; the default browser without one). The command ends when the window closes.

```bash
npm run build                                   # dist/, which the desktop app serves
node packages/cli/dist/studyflow.mjs ui         # as installed: `studyflow ui`
npm run dev:desktop                             # the dev server, opened the same way
```
