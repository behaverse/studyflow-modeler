# @behaverse/studyflow-modeler

The visual editor for studyflows: a native SVG canvas ([`@behaverse/studyflow-canvas`](../canvas/)) inside a React shell. The app generates its palette, inspector, templates, and connection rules from the `*.moddle.yaml` schemas in [`assets/schemas/`](../../assets/schemas/). Served at `/app.html`.

## Contract

- It owns **authoring** and nothing else. What a studyflow *means* lives in [`@behaverse/studyflow-core`](../core/); what a studyflow *does* lives in the runners.
- It never imports from [`packages/runner`](../runner/). ESLint refuses it. Shared code goes to core.
- It hands a studyflow to the browser runner through `localStorage` under `studyflow-modeler:handoff:<id>` (an 8-character uuid slice, swept after an hour) and opens `/run/?diagram=<id>`. There is no code path between the two apps.
- **Two UI technologies own different pixels**, split at the edge of the canvas: React outside it, the canvas package's own SVG inside. `src/editor/mount.ts` mounts that canvas and `src/editor/editor.ts` assembles the `Editor` facade over it — the right first pair of files to read for canvas behavior. `src/editor/port.ts` is the app's door onto the facade, and the only way app code reaches the editor.
- **Views dispatch commands by name** and never call a handler directly: a command's `type` *is* its handler's name, so `{ type: 'SetColor' }` runs `runSetColor`, exported from a feature's `commands.ts`. Both sides of the pixel split dispatch onto the same bus, `src/commandBus.ts`.
- **Adding an element type is a schema edit, not a code edit.** Dropping a `*.moddle.yaml` into `assets/schemas/` gives you a palette entry, inspector fields and tabs, connection rules, templates, and round-tripping, with no code here.
- It updates the provenance timeline on export: `created` on a fresh diagram, `modified` afterwards, once per edit batch. It never writes `executed`. The only other entry it writes is the `invalidated`.

## Where things are

One folder per feature. Everything the palette is lives in `src/palette/`: its data, its React, its commands.

| Folder | What it holds |
| --- | --- |
| `src/app/` | the shell: `App.tsx`, `Modeler.tsx`, contexts, notices, boot commands |
| `src/editor/` | the editor facade: `port.ts` (the door), `editor.ts` (the assembly), `mount.ts` (canvas + app services), history, popup registry |
| `src/palette/` `src/popup/` `src/commandPalette/` | the three ways to place an element |
| `src/inspector/` | the attribute panel: tabs, editors, sections, data neighbors |
| `src/draw/` `src/shape/` | icon and choreography-band geometry the canvas reads, and how an element's business object is built |
| `src/export/` `src/import/` | the file formats below, plus jsPsych import |
| `src/diagram/` `src/templates/` `src/examples/` | file open/save and auto-layout, the template gallery, the examples gallery |
| `src/provenance/` `src/checklist/` `src/gantt/` | the three views over a diagram's metadata |
| `src/simulation/` | token simulation, which animates the graph's shape and proves nothing about a run |
| `src/publish/` `src/settings/` `src/navBar/` `src/ui/` | publishing to `api.behaverse.org`, settings, chrome |
| `src/commandBus.ts` | the bus, and the `FEATURES` list a feature joins |

Inside a feature, three file names recur: `commands.ts` (its bus handlers), `PascalCase.tsx` (one React view), and everything else named for what it does. Feature folders have no barrels. You import the path of the file you want. [Architecture](../../README.md#architecture-in-short) has the rules and the reasoning.

## Export formats

Declared once, in `src/export/formats.ts`.

| Group | Formats |
| --- | --- |
| Diagram | `.studyflow.yaml` (canonical; `.studyflow` still reads), `.bpmn` |
| Image | `.studyflow.svg`, `.studyflow.png`. Both embed the studyflow source *and* an editable draw.io diagram, so one figure reopens in either editor |
| Interchange | `.drawio`, `.linkml.yaml`, `.nidm.ttl`, `.artemis.json` |

PNG and SVG export fetch icon glyphs from `api.iconify.design` at export time, and degrade with a notice when offline.

## The examples gallery

`src/examples/` globs `assets/examples/*.png` and reads each card out of the diagram itself: the root's `name` is the title (falling back to its id, then the filename), the first sentence of its `bpmn:documentation` is the blurb, and `studyflow:tags` on the root are the shelves it sits on. All of that is editable in the inspector's Documentation tab. The filter chips are whatever tags the shipped examples declare.

To add one, drop a `.studyflow.yaml` into `assets/examples/` and render it; the PNG replaces it as the shipped file, and you can then delete the YAML.

```bash
npm run examples:render              # all of them, from the repo root
npm run examples:render kitchensink  # just this one
```

Re-run it after editing an example (open the PNG, edit, export PNG over it) or after a change to how diagrams are drawn. It drives a headless Chromium through this app's own PNG export, so it needs network access for the icon glyphs.

## More

- [Specification](../../docs/specification.qmd#projections): what the checklist, Timeline, and provenance views are, and why they cannot contradict the file.
- [Reference](../../docs/reference.qmd#the-file): every format this app reads and writes.
- [Architecture](../../README.md#architecture-in-short): the packages, the two boundaries, the pixel split, the command bus.
- [assets/schemas/README.md](../../assets/schemas/README.md): the schema vocabulary this app reads.
