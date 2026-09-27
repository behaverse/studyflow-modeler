# @behaverse/studyflow-canvas

Studyflow's editable SVG canvas: plain TypeScript and SVG, no bpmn-js and no framework. A `Study` is the document, with no DOM: its reads, its verbs, its undo history and the news of each change, all by id. A `Canvas` is a view of one, and several may share it. `renderSvg` draws one without a view. The index (`src/index.ts`) exports those three and their types, nothing else; `./element` is `<studyflow-canvas>`. The modeler imports the index only (lint-enforced).

```ts
const study = await Study.open(yamlOrXml, { moddle });
const canvas = new Canvas(container, study);

const made = study.append({ from: 'Consent', type: 'bpmn:UserTask', name: 'Screen' }); // { ok, id, added, changed, removed }
study.can('connect', { from: made.id! });                                              // { ok, reason? }, writing nothing
study.on('change', ({ cause, added, changed, removed }) => { /* ids */ });
canvas.select(made.id!);
```

## Study

- **Open and write the file:** `Study.open(text, { moddle })` (`.studyflow.yaml` or BPMN XML), `Study.fromDefinitions(definitions)`, `load(text)`, `toYaml()`, `toXml()`.
- **Read, as data:** `root`, `get(id)` and `list({ kind, type, within })` return `ElementRecord`s: what an element is, where it sits and on which plane, its links by id, and the look `style` gave it. `catalog()` is what `add` takes (the BPMN shape types, the schema types extending them, the templates). `revision`, `canUndo`, `canRedo`. In-process only: `definitions` and `businessObject(id)`, the moddle a record leaves out.
- **Verbs**, each one JSON argument naming elements by id, each one `StudyResult` (the ids it added, changed and removed, the `id` of what it made, or `ok: false` and why): `add`, `append`, `connect`, `replace`, `move` (by a delta, and into a container), `reconnect`, `resize`, `reroute`, `set` ('name' renames; an attribute no schema declares is refused), `remove`, `style`, `expand`, `collapse`, `batch({ steps })` (verbs by name, one edit and one undo step, all or nothing), `undo`, `redo`. In-process only: `edit(id, write)`, for moddle writes `set` cannot spell.
- **Would it run?** `can(tool, args)` answers for `append`, `connect` and `replace` by the rules they ask, without writing; what it leaves out it asks about any (`can('append', { from })`: may anything follow?).
- **Changes:** `on('change')` says each one once, by id: an edit (one commit), a load, an undo, a redo.
- **For an AI**, in the shape MCP lists and calls tools: `Study.tools` (each a name, a description, the JSON Schema of its one argument, read-only and destructive hints) and `call(name, args)` (the argument checked against its schema, a write all or nothing, one JSON object back). The reads are `document` (the `.studyflow.yaml` text), `get`, `list`, `catalog` and `can`; every verb but `edit` is a tool. An MCP server is a thin adapter over `tools`, `call` and `on('change')`.

## Canvas

`new Canvas(container, study, { iconResolver, editable, snapToGrid })` draws in the container's document. Each view keeps its own selection, scope and camera; `editable: false` (or `setEditable`) makes one a view to look at: it selects, pans and zooms, and edits nothing.

- **Selection and scope:** `selection` (ids) and `select(ids)`; `scope` (the id of the container the view is drilled into), `setScope(id)` (`undefined` goes back out) and `scopePath`; `draws(id)`, whether the view draws an element.
- **Camera:** `viewbox` and `setViewbox(box)`, `zoom(to)` (a scale, `'in'`, `'out'` or `'fit'`), `reveal(id)`, `screenBox(id)` (an element's box on screen).
- **Host overlays:** `anchor(el, ids)` keeps a host element beside the outline of those elements, following the camera and the edits and stepping aside for a gesture (the context pad floats on it); `mark(ids, marker, on?)` draws `dimmed` and `error` itself, and any other marker is a class `sf-mark-<marker>` for the host's CSS; `layer(name)` is a layer of the host's own above the diagram, in diagram coordinates. The palette is also CSS properties (`--sf-ink-text` and the rest), for a host drawing beside it.
- **A person's edits:** `startCreate(event, what)`, `append(from, what)` and its ghost `previewAppend(from, what)`, `startConnect(from, event)`, `editLabel(id)`, `selectAll()`, `deleteSelection()`, each over the study's verbs. Ctrl/Cmd+Z undoes and Shift+Ctrl/Cmd+Z redoes, through the study.
- **Events**, through `on(event, listener)`: `select` (the ids selected), `scope` (what it shows: on a drill-down, and whenever it draws its study afresh after a load, an undo or a redo, before it reselects), `appendMenu` (the `a` key, on the selection). What an edit did, the study says, after every view has drawn it.
- `destroy()` hands the container back clean.

A caption shows the run state its `{placeholders}` name; the model keeps the raw name. Icons are what `iconResolver` answers for a type (`null` draws none), and otherwise the canvas's own glyph, when it has one.

## renderSvg

`renderSvg(study, { scope, document, iconResolver })` is a picture of what a view drilled into `scope` shows, framed on it, with none of the editor's chrome: a gallery card, an export. Outside a browser, hand it a `document` (jsdom's).

## The element

`defineStudyflowCanvas()` registers `<studyflow-canvas>`, built on the index alone (lint-enforced). A page hands it a study (`element.study = study`), or names a file with `src` once `element.moddle` says how to read one (a `studyflow-error` event says why a read failed); `readonly` makes it a view to look at, and `element.canvas` is the view while it shows one. It draws in its own light DOM, so give it a size.

## Inside

| Folder | What |
| --- | --- |
| `Canvas.ts` | The view. It owns the `<svg>`, the viewport, the renderer, the selection, the label editor and the gestures. |
| `study/` | Everything that needs no DOM (lint-enforced). `Study.ts` is the document and its verbs; `tools.ts` the verbs as tools, `catalog.ts` what they add, `records.ts` an element as data, `writer.ts` what an `edit` writes through. `import.ts` builds the scene from the definitions and their DI, `mutator.ts` is the only thing that commits an edit, `di.ts` writes the DI back. `rules.ts` says what may connect, contain or resize what (a schema's `meta.connectsTo` first, then plain BPMN); `tree.ts` answers containment, paint order and visibility; `orthogonal.ts` routes edges and `edit.ts` edits bendpoints, both docking on core's `document/outline.ts`; `drag.ts` moves, resizes and drops, `hit.ts` hit-tests, `autoplace.ts` places an append; `prototype.ts` describes a new element as data (`NewElement`), `templates.ts` lays a template's elements out; `labels.ts` keeps captions and `text.ts` measures them. |
| `interaction/` | Pointer and keyboard. `gestures.ts` turns a press into one gesture and drives `study/drag.ts`, `create.ts` or `connect.ts`, through the tools `Canvas.ts` hands it; also `selection.ts`, `labelEditing.ts`, `snapping.ts`. |
| `render/` | One `<g>` per element (`renderer.ts`), the shapes, captions and icons; `renderSvg.ts`. |
| `view/` | The viewport, the layers, the `INK` palette and the canvas CSS. |
| `element.ts` | `<studyflow-canvas>`: the package's second entry. |

An edit, end to end: a pointer press becomes a gesture; while it moves, the gesture writes geometry into the scene and redraws what it touched. On release the mutator commits: the business objects change, `scene.revision` goes up, the study keeps the new document for undo and says what changed, by id; each view draws what the commit added, changed and removed. An edit made of several (a replace, an append, a move into a container) is one commit.

## What holds

- The mutator is the only committed writer, and every commit bumps `scene.revision`. A view draws from the commit, so an edit never redraws by hand.
- The scene is the truth while editing. The canvas reads DI only in `study/import.ts` and writes it only in `study/di.ts`, as one plane. It reads the first plane only; what a further one draws is dropped, with a warning.
- A caption is an element of its own, with the id `<owner id>_label`.
- Paint order is `zRankOf` (`study/tree.ts`).
- A view's scope is its own state, not the scene's. An edge docks on what its own plane shows (`planeOf`), whatever a view is drilled into.
- Undo is the study's. After each commit it keeps the document as `.studyflow.yaml` text (unless the text is what it already holds); `undo()` and `redo()` read one back as a new scene, and each view draws it afresh, keeping its scope, camera and selection by id. A load starts the history over.

## Tests

```bash
npx playwright test --config playwright.unit.config.ts packages/canvas
```

The specs run in Node against a jsdom document (`tests/canvasHarness.ts`). `study.unit` drives the study with no DOM, as a host and as an MCP client would; `canvas-render` imports every shipped example and checks the drawing against its DI.

## Left out on purpose

The canvas is its own design, not a bpmn-js copy. Nested drill-down planes, the grid, segment grips, label leaders, the lasso tool, ghost clones and per-shape outlines were removed; do not bring them back.
