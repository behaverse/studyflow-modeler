# @behaverse/studyflow-modeler

The visual editor: an SVG canvas ([packages/canvas](../canvas/)) in a React shell, with the palette, inspector, templates, and connection rules generated from the skills' schemas. Served at `/app.html`; `/` is the landing page, and the examples gallery is the app's New dialog.

```bash
npm run dev                          # from the repo root: http://localhost:5173/app.html
```

An example is a `.studyflow.yaml` in `skills/<name>/examples/`, saved from the modeler. The gallery draws its card when it opens (`src/examples/preview.ts`).

## How it is put together

`app.html` loads `src/index.tsx`, which renders `app/App.tsx`. `app/Modeler.tsx` boots: it loads the enabled schemas (`@core/notation/loader`), opens the autosaved diagram or a new one as a `Study`, and mounts the editor on it (`editor/mount.ts`: the canvas, the template list, the token simulator). App then mounts the rest of the UI around it, each part reading the editor through `useModeler()`.

A view changes the document by sending a command: `executeCommand(editor, { type: 'X', … })` travels the editor's event bus to `runX`, exported by one of the modules `commandBus.ts` lists (a feature's `commands.ts`, and `diagram/save.ts`), and `runX` edits through the study: `study.set` for an attribute, `study.edit` for anything more, one command one undo step. `tests/commands.unit.spec.ts` checks that every `runX` is dispatched from somewhere. The editor's bus (`editor/bus.ts`, built in `editor/mount.ts`) then carries `ElementsChanged` once for the edit, by id, and `HistoryChanged` (on an undo and a redo too), which autosave and the provenance dialog listen to; the study keeps the undo history. `mount.ts` forwards onto the bus what the canvas announces (`SelectionChanged`, `RootSet`, the `a` key as `OpenAppendMenu`) and what the study says; views read the study by id and subscribe to the bus topics they care about.

| Folder | What |
| --- | --- |
| `app/` | Boot, the top-level layout, the editor and mode contexts (`contexts.ts`: editing, simulating or replaying), the dialogs (`Dialogs.tsx`: which one is open, and the hidden `open-file-input` the CLI and the e2e specs drive), notices. |
| `editor/` | The `Editor` type (`port.ts`), `mountEditor`, the snapshot history, the popup-menu registry. |
| `diagram/` | The file formats (`formats.ts`: what opens, what saves, what a skill adds), importing (`commands.ts`), layout for files without DI, autosave, the linked file (`fileHandle.ts`) and saving back into it (`save.ts`), and the notice that only a PNG keeps a pasted image (`pastedImageNotice.ts`). |
| `open/`, `export/` | The Open dialog and the picker; the encoders (`commands.ts`), the Save dialog and the export model the projections read. |
| `inspector/` | The side panel, closed by default (`visibility.ts`, kept with the Settings): closed, a selected shape's pad holds the inline inspector (`InlineInspector.tsx`), its name and the fields its schema marks `showInline` (`categories.ts`'s `inlineFields`), and All properties opens the panel. `Panel.tsx` follows the selection, `categories.ts` files attributes under tabs, `registry.tsx` picks an input per attribute (`inputs.tsx`, `editors.tsx`). A section a tab shows beyond attributes is its own file (`state.tsx`, `dataFlow.tsx`, `loop.tsx`, `participants.tsx`, `message.tsx`), each over a pure helper module the unit specs pin. |
| `palette/`, `popup/`, `contextPad/`, `commandPalette/`, `navbar/`, `composer/`, `drilldown/` | The chrome around the canvas. The tools column on the left holds the five kinds, each a flyout, the entries a person pinned, and the + that opens the Add panel (`popup/addMenu.ts`): everything the enabled skills add (`palette/catalog.ts`, which the flyouts and the pad's Change menu read too), found by name and narrowed by skill, and in its Templates view each template drawn as what it drops (`palette/templatePicture.ts`); a double click on the canvas opens it there, and the pad's append (or `a`) after the selection. The nav bar is the top row: the app's menu (the app's own commands: new, open, save, settings, docs) and the file (`FileStatus.tsx` over the pure `fileState.ts`), the drill-down trail, and the inspector's toggle. The composer is the bar at the bottom that turns to what is needed (`face.ts` picks its face from the app's state): a first step on a blank study, the commands with Simulate and Run, the selection as their context, a simulation's transport (pause, step, stop), a replay's (the run trail's transport and track, `provenance/Replay.tsx`), a version written into the file elsewhere, to accept or discard (`review/`), and the plan's checklist before a run, each problem showing its element and mending it where its check says how (core's `Issue.fix`). The composer's prompt and ⌘K open the one palette (`PaletteProvider.tsx`), which grows out of the composer. Unsearched it lists what is at hand: the pad's commands on the selection (`contextPad/entries.ts` says what both offer, `contextPad/actions.ts` runs it), then the study's; the app menu's own are found by name. |
| `review/` | A version written into the linked file elsewhere, such as an assistant's through `studyflow mcp`'s save: `watch.ts` looks at the file while the page is in view, and `commands.ts` brings the version onto the canvas as one edit (the study's `adopt`), read-only and marked, until Accept keeps it as one undo step or Discard puts the canvas's own back, for the next save to write. The composer's review face lists what it changed (`changes.ts`). |
| `provenance/`, `simulation/`, `minimap/` | The run trail and its replay, the composer's replay face; the token simulator, which shows dry runs of core's walk and pauses or steps to where a token arrives next; the minimap, the whole diagram small with the elements a host names ringed (the replay's current step). |
| `views/`, `schedule/`, `checklist/` | The drawer under the canvas (`views/Drawer.tsx`), which the composer's toggle and the View commands open: the schedule, the checklists (ticked and added to there) and the provenance, one at a time, each following the selection and selecting what is pressed in it; an empty one offers what it needs, and the drawer maximizes into a dialog for a view that needs the room. |
| `settings/`, `gallery/`, `examples/`, `shape/`, `draw/`, `ui/` | Settings, the New dialog (its question, `gallery/starters.ts`, lays out the parts the skills offer and turns their skills on; then the examples), element commands, icon maps, shared styles. A template drops through the canvas (`study/templates.ts`). A skill turned on loads without a reload (`app/skills.ts`): the study is read again on the new metamodel; turning one off waits for a reload. |

The chrome keeps one job per edge, so where a thing is follows from what it is: the top row says where you are (the file, the trail), the left holds what to add, the right the details of what is shown, the bottom what to do next; the context pad acts on the selection beside it. Each action has one place to see it, and at most one key: the app menu holds the app's own (New, Open, Save As, Settings, Help), the composer the study's, the pad the selection's, and ⌘K finds any of them by name. The selection wears the one accent everywhere it shows (its outline, the pad's ring, the inspector's dot, the composer's chip), and Esc lets it go.

Skills add to the modeler through `skills/<name>/modeler.ts` (`skillModules.ts`), with its components in `skills/<name>/modeler/`: exports it writes, foreign formats it opens, inspector sections (`inspector/sections.tsx`), each under a schema category's tab, pages of Settings (`settings/sections.ts`), places "Save" sends a study besides this machine (`export/destinations.ts`), and the parts of a study the New dialog offers (`starters`); the behaverse skill's account and publishing are these last two.

## Where state lives

The document lives in the canvas's study, a study model; views keep React state. What outlives a component is in a few module-level stores, each read through `useSyncExternalStore` where a view shows it:

| Store | What |
| --- | --- |
| `settings/store.ts` | Settings, the API key and email, the autosaved diagram, the inspector width: everything in localStorage. |
| `diagram/fileHandle.ts` | The link to the file on disk, its state (clean, dirty, saving, conflict, blocked, error) and the edit counters behind it; the handle survives a reload through IndexedDB. |
| `app/noticeStore.ts` | The notices at the bottom of the screen. |
| `editor/popupMenus.ts` | Which component opens each popup menu, so the pad, the `a` key and a double click on the canvas open one without holding a component. |
| `examples/entries.ts` | The gallery cards, read once a page. |

Everything else is derived from the document on each render, or held by the editor (`editor/mount.ts`: the study with its history, the template list, the simulator).
