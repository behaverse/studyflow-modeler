# @behaverse/studyflow-canvas

The editable SVG canvas the modeler draws on: plain TypeScript and SVG, no bpmn-js and no framework. A `Study` is the document and its edits; a `Canvas` is a view of one. The modeler holds one `Canvas` (as `editor.canvas`, its study as `editor.canvas.study`) and imports nothing but `src/index.ts`.

| Folder | What |
| --- | --- |
| `Canvas.ts` | The object the host holds: a view of a study. It owns the `<svg>`, the viewport, the renderer, the selection, the label editor and the gestures, and every public method is here. |
| `study/` | Everything that needs no DOM (lint-enforced): the document and its writes. `Study.ts` opens a file (YAML or XML) or definitions, holds the scene, the mutator and the undo history, announces each change to the views that draw it, and writes the file back; `import.ts` builds one scene tree from the definitions and their DI; `mutator.ts` is the only thing that commits an edit; `di.ts` writes the DI back on save; `labels.ts` keeps captions and `text.ts` measures them; `tree.ts` answers containment, paint order and visibility; `rules.ts` says what may connect, contain or resize what (a schema's `meta.connectsTo` first, then plain BPMN); `orthogonal.ts` routes edges and `edit.ts` edits bendpoints, both docking on core's `document/outline.ts`; `drag.ts` moves, resizes and drops, `hit.ts` hit-tests, `autoplace.ts` places an append, `prototype.ts` describes a shape before it exists. |
| `interaction/` | Pointer and keyboard. `gestures.ts` turns a press into one gesture and drives `study/drag.ts`, `create.ts` or `connect.ts`, through the canvas's public API and the few tools `Canvas.ts` hands it; also `selection.ts`, `labelEditing.ts`, `snapping.ts`. |
| `render/` | One `<g>` per element (`renderer.ts`), the shapes, captions and icons; `renderSvg.ts` draws a study as a standalone SVG, without a canvas. |
| `view/` | The viewport (pan, zoom, fit), the layers, the `INK` palette and the canvas CSS. |

An edit, end to end: the modeler opens the file as a `Study` (`Study.open`), which builds the scene, and puts a `Canvas` on it, which draws it. A pointer press becomes a gesture; while it moves, the gesture writes geometry into the scene and redraws what it touched. On release the Mutator commits: the business objects change, `scene.revision` goes up, and the Study announces the change; the Study keeps the new state for undo; the canvas draws what the commit added, changed and removed, then fires `ElementsChanged`. An edit made of several (a replace, an append, a move into a container) is one commit: `batch()`. `study.load()` replaces the document, and each view draws it afresh. Saving calls `study.toXml()`, which rebuilds the DI from the scene and serializes.

## What holds

- The Mutator is the only committed writer, and every commit bumps `scene.revision`. The canvas draws from the commit, so an edit never redraws by hand.
- The scene is the truth while editing. The canvas reads DI only in `study/import.ts` and writes it only in `study/di.ts`, as one plane. It reads the first plane only; what a further one draws is dropped, with a warning.
- A caption is an element of its own, with the id `<owner id>_label`.
- Paint order is `zRankOf` (`study/tree.ts`).
- Drilling into a container sets the canvas's `scope`: view state, not the scene's, so it is a view of the same scene, not another plane. An edge docks on what its own plane shows (`planeOf`), whatever a view is drilled into.
- Undo is the Study's. After each commit it keeps the document as `.studyflow.yaml` text (unless the text is what it already holds); `undo()` and `redo()` read one back as a new scene, and each view draws it afresh, keeping its scope, camera and selection by id. A load starts the history over.

## What the host provides and gets

- `new Canvas(container, study, options)` draws in the container's document. Options: `iconResolver` (a glyph for a type; answering `null` draws none), `labelText` (a caption's text, placeholders resolved). The study's: `onWarning` (import problems).
- `renderSvg(study, { scope, document, ...options })` is a picture of what a view drilled into `scope` shows, framed on it, with none of the editor's chrome: a gallery card, an export. Outside a browser, hand it a `document` (jsdom's).
- On the event bus (`getEventBus()`): `SelectionChanged`, `ElementsChanged` (once per commit: `elements` added or changed, the root among them when its own properties changed, and `removed`), `RootSet` (what the view shows: on a drill-down, and whenever it draws its study afresh after a load, an undo or a redo, before it reselects). The `a` key sends the command `OpenAppendMenu`, which the host must answer. Ctrl/Cmd+Z undoes and Shift+Ctrl/Cmd+Z redoes, through the study.
- `getHostLayer(name)` gives the host a layer of its own above the diagram (the token simulation draws there).

## Tests

```bash
npx playwright test --config playwright.unit.config.ts packages/canvas
```

The specs run in Node against a jsdom document (`tests/canvasHarness.ts`). `canvas-render` imports every shipped example and checks the drawing against its DI: a group per shape at its bounds, a path per edge through its waypoints.

## Left out on purpose

The canvas is its own design, not a bpmn-js copy. Nested drill-down planes, the grid, segment grips, label leaders, the lasso tool, ghost clones and per-shape outlines were removed; do not bring them back.
