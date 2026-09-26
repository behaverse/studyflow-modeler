# @behaverse/studyflow-modeler

The visual editor: an SVG canvas ([packages/canvas](../canvas/)) in a React shell, with the palette, inspector, templates, and connection rules generated from the skills' schemas. Served at `/app.html`; `/` is the landing page, and the examples gallery is the app's New dialog.

```bash
npm run dev                          # from the repo root: http://localhost:5173/app.html
```

An example is a `.studyflow.yaml` in `skills/<name>/examples/`, saved from the modeler. The gallery draws its card when it opens (`src/examples/preview.ts`).

## How it is put together

`app.html` loads `src/index.tsx`, which renders `app/App.tsx`. `app/Modeler.tsx` boots: it loads the enabled schemas (`@core/notation/loader`), mounts the editor (`editor/mount.ts`: the canvas, a moddle, the undo history, templates, the token simulator) and opens the autosaved diagram or a new one. App then mounts the rest of the UI around it, each part reading the editor through `useModeler()`.

A view changes the document by sending a command: `executeCommand(editor, { type: 'X', … })` travels the editor's event bus to `runX`, exported by one of the modules `commandBus.ts` lists (a feature's `commands.ts`, and `diagram/save.ts`), and `runX` edits through the canvas. `tests/commands.unit.spec.ts` checks that every `runX` is dispatched from somewhere. The canvas then fires `ElementsChanged` once for the edit, and the history takes a snapshot and fires `HistoryChanged`, which autosave and the provenance dialog listen to. Views read the canvas and the moddle objects directly and subscribe to the bus topics they care about.

| Folder | What |
| --- | --- |
| `app/` | Boot, the top-level layout, the editor context, notices. |
| `editor/` | The `Editor` type (`port.ts`), `mountEditor`, the snapshot history, the popup-menu registry. |
| `diagram/` | The file formats (`formats.ts`: what opens, what saves, what a skill adds), importing (`commands.ts`), layout for files without DI, autosave, the linked file (`fileHandle.ts`) and saving back into it (`save.ts`). |
| `open/`, `export/`, `publish/` | The Open dialog and the picker; the encoders (`commands.ts`), the Save dialog and the export model the projections read; the upload to the Behaverse API. |
| `inspector/` | The side panel. `Panel.tsx` follows the selection, `categories.ts` files attributes under tabs, `registry.tsx` picks an input per attribute (`inputs.tsx`, `editors.tsx`). A section a tab shows beyond attributes is its own file (`state.tsx`, `dataFlow.tsx`, `loop.tsx`, `participants.tsx`, `message.tsx`), each over a pure helper module the unit specs pin. |
| `palette/`, `popup/`, `contextPad/`, `commandPalette/`, `navBar/`, `drilldown/` | The chrome around the canvas. The ⌘K palette also hosts the dialogs and the hidden `open-file-input` the CLI and the e2e specs drive. |
| `provenance/`, `simulation/` | The run trail and its replay; the token simulator. |
| `settings/`, `gallery/`, `examples/`, `checklist/`, `gantt/`, `templates/`, `shape/`, `draw/`, `ui/` | Settings, the examples gallery, the read-only views, templates, element commands, icon maps, shared styles. |

Skills add to the modeler through `skills/<name>/modeler.ts` (`skillModules.ts`): exports it writes and foreign formats it opens.

## Where state lives

The document lives in the canvas and its moddle; views keep React state. What outlives a component is in a few module-level stores, each read through `useSyncExternalStore` where a view shows it:

| Store | What |
| --- | --- |
| `settings/store.ts` | Settings, the API key and email, the autosaved diagram, the inspector width: everything in localStorage. |
| `diagram/fileHandle.ts` | The link to the file on disk, its state (clean, dirty, saving, conflict, blocked, error) and the edit counters behind it; the handle survives a reload through IndexedDB. |
| `app/noticeStore.ts` | The notices at the bottom of the screen. |
| `editor/popupMenus.ts` | Which component opens each popup menu, so the palette, the pad and the canvas open one without holding a component. |
| `examples/entries.ts` | The gallery cards, read once a page. |

Everything else is derived from the document on each render, or held by the editor (`editor/mount.ts`: the history, the templates, the simulator).
