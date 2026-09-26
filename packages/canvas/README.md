# @behaverse/studyflow-canvas

The editable SVG canvas the modeler draws on: plain TypeScript and SVG, no bpmn-js and no framework. The modeler holds one `Canvas` (as `editor.canvas`) and imports nothing but `src/index.ts`.

| Folder | What |
| --- | --- |
| `Canvas.ts` | The object the host holds. It owns the scene, the `<svg>`, the viewport, the renderer, the selection, the label editor and the gestures, and every public method is here. |
| `model/` | The scene and its writes. `import.ts` builds one scene tree from the definitions and their DI; `mutator.ts` is the only thing that commits an edit; `di.ts` writes the DI back on save; `labels.ts` keeps captions; `tree.ts` answers containment, paint order and visibility. |
| `interaction/` | Pointer and keyboard. `gestures.ts` turns a press into one gesture and drives `drag.ts`, `create.ts` or `connect.ts`; also `selection.ts`, `labelEditing.ts`, `hit.ts`, `snapping.ts`, `autoplace.ts`. |
| `render/` | One `<g>` per element (`renderer.ts`), the shapes, captions and icons. |
| `routing/` | Orthogonal edge routes (`orthogonal.ts`), docking on a shape's outline (`crop.ts`), bendpoint edits (`edit.ts`). |
| `rules/rules.ts` | What may connect, contain or resize what: a schema's `meta.connectsTo` first, then plain BPMN. |
| `view/` | The viewport (pan, zoom, fit), the layers, the `INK` palette and the canvas CSS. |

An edit, end to end: the modeler parses the XML and hands the definitions to `importDefinitions`, which builds the scene and draws it. A pointer press becomes a gesture; while it moves, the gesture writes geometry into the scene and redraws what it touched. On release the Mutator commits: the business objects change, `scene.revision` goes up, the canvas draws what the commit added, changed and removed, and `ElementsChanged` fires, which the modeler's undo history records. An edit made of several (a replace, an append, a move into a container) is one commit: `batch()`. Saving calls `syncDi()`, which rebuilds the DI from the scene, and then serializes.

## What holds

- The Mutator is the only committed writer, and every commit bumps `scene.revision`. The canvas draws from the commit, so an edit never redraws by hand.
- The scene is the truth while editing. The canvas reads DI only in `model/import.ts` and writes it only in `model/di.ts`, as one plane. It reads the first plane only; what a further one draws is dropped, with a warning.
- A caption is an element of its own, with the id `<owner id>_label`.
- Paint order is `zRankOf` (`model/tree.ts`).
- Drilling into a container sets the scene's `scope`; it is a view of the same scene, not another plane.

## What the host provides and gets

- Options: `iconResolver` (a glyph for a type; answering `null` draws none), `labelText` (a caption's text, placeholders resolved), `onWarning` (import problems), `mainCanvasOnly` (import nothing inside a sub-process, for a view that only reads, such as a thumbnail).
- On the event bus (`getEventBus()`): `SelectionChanged`, `ElementsChanged` (once per commit: `elements` added or changed, the root among them when its own properties changed, and `removed`), `RootSet`. The `a` key sends the command `OpenAppendMenu`, which the host must answer.
- `getHostLayer(name)` gives the host a layer of its own above the diagram (the token simulation draws there). Outside a browser, `setDocument` supplies the DOM.

## Tests

```bash
npx playwright test --config playwright.unit.config.ts packages/canvas
```

The specs run in Node against a jsdom document (`tests/canvasHarness.ts`). `canvas-render` imports every shipped example and checks the drawing against its DI: a group per shape at its bounds, a path per edge through its waypoints.

## Left out on purpose

The canvas is its own design, not a bpmn-js copy. Nested drill-down planes, the grid, segment grips, label leaders, the lasso tool, ghost clones and per-shape outlines were removed; do not bring them back.
