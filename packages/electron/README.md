# @behaverse/studyflow-electron

The modeler in an Electron window for demos. Local only, not the desktop app, not distributed, and not a workspace, so a plain `npm install` never downloads Electron.

```bash
npm install --prefix packages/electron                          # once
npm run build                                                   # the modeler into dist/
npm start --prefix packages/electron -- study.studyflow.png     # open it; without a file, a blank canvas
npm run dev:electron                                            # the dev server inside the window
```

To remove this module, delete this folder and the `!packages/electron` line in the root `package.json`.
