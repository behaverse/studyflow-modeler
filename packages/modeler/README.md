# @behaverse/studyflow-modeler

The visual editor: an SVG canvas ([packages/canvas](../canvas/)) in a React shell, with the palette, inspector, templates, and connection rules generated from the skills' schemas. Served at `/app.html`; `/` is the landing page, and the examples gallery is the app's New dialog.

```bash
npm run dev                          # from the repo root: http://localhost:5173/app.html
npm run examples:render              # redraw every example PNG, after a canvas or file-format change
npm run examples:render kitchensink  # just this one; `-- --origin <url>` reuses a running modeler
```

An example is a `.studyflow.png` in `skills/<name>/examples/`: save it from the modeler, or draw one from YAML with `studyflow convert --modeler study.studyflow.yaml skills/<name>/examples/study.studyflow.png`. A schema can also ship YAML examples in its `examples:` block.

## How it is put together

`app.html` loads `src/index.tsx`, which renders `app/App.tsx`. `app/Modeler.tsx` boots: it loads the enabled schemas (`@core/notation/loader`), mounts the editor (`editor/mount.ts`: the canvas, a moddle, the undo history, templates, the token simulator) and opens the autosaved diagram or a new one. App then mounts the rest of the UI around it, each part reading the editor through `useModeler()`.

A view changes the document by sending a command: `executeCommand(editor, { type: 'X', … })` travels the editor's event bus to `runX`, exported by a feature's `commands.ts` and registered in `commandBus.ts`, and `runX` edits through the canvas. The canvas then fires `ElementChanged`, and the history takes a snapshot and fires `HistoryChanged`, which autosave and the provenance dialog listen to. Views read the canvas and the moddle objects directly and subscribe to the bus topics they care about.

| Folder | What |
| --- | --- |
| `app/` | Boot, the top-level layout, the editor context, notices. |
| `editor/` | The `Editor` type (`port.ts`), `mountEditor`, the snapshot history, the popup-menu registry. |
| `diagram/` | Importing (`commands.ts`), layout for files without DI, autosave, the linked file and saving back into it. |
| `open/`, `export/`, `publish/` | Opening a file; the formats, the Save dialog and the exports; the upload to the Behaverse API. |
| `inspector/` | The side panel: tabs built from the catalog's categories, one input per attribute type, and custom sections. |
| `palette/`, `popup/`, `contextPad/`, `commandPalette/`, `navBar/`, `drilldown/` | The chrome around the canvas. The ⌘K palette also hosts the dialogs and the hidden `open-file-input` the CLI and the e2e specs drive. |
| `provenance/`, `simulation/` | The run trail and its replay; the token simulator. |
| `settings/`, `gallery/`, `examples/`, `checklist/`, `gantt/`, `templates/`, `shape/`, `draw/`, `ui/` | Settings, the examples gallery, the read-only views, templates, element commands, icon maps, shared styles. |

Skills add to the modeler through `skills/<name>/modeler.ts` (`skillModules.ts`): exports it writes and foreign formats it opens.
