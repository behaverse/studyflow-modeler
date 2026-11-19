# @behaverse/studyflow-desktop

The desktop app: `studyflow ui [file]` serves the webapp's `dist/` from this machine and opens it in a Chromium app window (Chrome, Chromium, Brave, or Edge; the default browser without one). The command ends when the window closes. It also serves the schemas of the skills installed beside the CLI (`studyflow skill add`) as `installed-skills.json`, which the modeler loads with its own, locked on in Settings. And it keeps the files it opened in `$STUDYFLOW_HOME/recent.json` (`recent.ts`): each is served again at a path of its own, which the page reads, writes with a PUT, and POSTs when it opens the file again, and their list is `/recent.json`, which the modeler's New dialog shows under Recent and a DELETE from the page forgets.

```bash
npm run build                                   # dist/, which the desktop app serves
node packages/cli/dist/studyflow.mjs ui         # as installed: `studyflow ui`
npm run dev:desktop                             # the dev server, opened the same way
```
