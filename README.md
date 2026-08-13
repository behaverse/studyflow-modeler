
# Behaverse Studyflow Modeler

Studyflow Modeler is a tool to design and run cognitive experiments using [Studyflow diagrams](https://behaverse.org/projects/studyflows). It ships two browser apps backed by a shared core library:

- **Modeler** (`app.html`) - visual editor for `.studyflow` (BPMN 2.0 XML) diagrams, with a pluggable schema palette covering cognitive, data, and domain-specific element types. Diagrams export to SVG, PNG, draw.io, LinkML, NIDM-Results, and ARTEM-IS; exported SVG and PNG carry both the studyflow source and a draw.io diagram, so one figure reopens in either editor.
- **Runner** (`run/`) - executes a `.studyflow` diagram end-to-end in the browser: parses the XML, validates it, and walks the flow node-by-node (consent, instructions, questionnaires, cognitive tasks, Behaverse tasks). Supports optional event recording to a Behaverse data server and LLM/bot-driven task execution.
- **CLI** (`packages/cli`) - a standalone `studyflow` binary to convert (`.studyflow` YAML ↔ BPMN XML ↔ `.studyflow.png`), validate, and inspect studyflow files headlessly.
- **Python runner** (`packages/runner-py`) - executes a `.studyflow.png`; also a `uv run --script` one-liner.

## Development

With Node.js **≥ 20.19** installed, start both apps in dev mode:

```bash
npm install
npm run dev          # serves /app.html (modeler) and /run/ (runner)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the test strategy, quality gates,
and the schema-authoring loop.

To run the documentation site locally:

```bash
npm run docs         # quarto preview with live reload
npm run docs:build   # render to dist/docs/
```

## Project layout

**One folder per feature.** To change the palette you open `modeler/palette/`,
and everything the palette is — its data, its React, its bpmn-js wiring, its
commands — is in there. There is no `models/`, `views/`, or `controllers/` split
to navigate; a feature is not spread across the tree.

```
packages/core/src/ the shared model (@behaverse/studyflow-core) — no React, no bpmn-js
  notation/        what a studyflow can contain: the *.moddle.yaml schemas
                   parsed (schemaFile, loader, manifest) and compiled into the
                   queryable type index (compile -> query, types, bpmn,
                   palette, templates)
  document/        reading and writing .studyflow files: YAML <-> BPMN XML
                   (serialize, deserialize, format, shorthand, checklist) plus
                   the two round-trip transforms (choreography, io-specification)
  element/         attribute access on one element (handle, attributes, moddle)
  constants.ts naming.ts implementation.ts settings.ts storage.ts

packages/modeler/src/       the editor — one folder per feature
  app/             the shell: App, Modeler, contexts, notices, boot commands
  bpmn/            bpmn-js glue: behaviors, the modeling updater, DI module,
                   upstream type aliases
  palette/ inspector/ draw/ export/ diagram/ templates/ simulation/
  provenance/ checklist/ gantt/ examples/ navBar/ publish/ settings/
  shape/ contextPad/ commandPalette/ import/ ui/
  commandBus.ts constants.ts

packages/runner/src/        the executor
  nodes/<type>/    one folder per node type: its view, validation, and bridge
  flow.ts jobs.ts scope.ts studyflow.ts session.ts ...
```

Four file-naming rules, and they hold everywhere:

| file | what it is |
| --- | --- |
| `<feature>/commands.ts` | every bus command the feature handles (`run*` handlers) |
| `<feature>/module.ts` | its bpmn-js DI registration, if it has one |
| `PascalCase.ts(x)` | one React view or one bpmn-js class, named after it |
| everything else | named for what it does |

App feature folders have no barrels. Each `core/` package instead has one
entry module (`index.ts`) that is its public surface:
`@core/document` and `@core/element`
are the only paths anything outside them imports, and `notation`'s also hosts
the catalog singleton and documents the boot sequence.

Only two boundaries are enforced (by ESLint, in `eslint.config.js`):

1. `core/` is framework-free — no React, no bpmn-js, no app imports. If it
   touches a framework or the DOM, it cannot go there.
2. `modeler/` and `runner/` never import each other. Shared code goes to `core/`.

Inside a feature there is nothing further to police, which is the point: a
feature owns its whole stack, so the compiler and the folder agree.

Two conventions worth knowing:

- **Commands.** Views dispatch by name and never call a handler directly. A
  command's `type` *is* its handler's name — `{ type: 'SetColor' }` runs
  `runSetColor` — so there is no registry to keep in step. Adding a command to
  an existing feature is a single edit: export `run<Name>(modeler, command)`
  from its `commands.ts` and give the command type `type: '<Name>'`. (A brand
  new feature additionally adds itself to the `FEATURES` array in
  `commandBus.ts` — one line; the types follow.) Dispatching a name no handler
  matches fails to compile, dispatch results are typed from the handler's
  return, and `tests/commands.unit.spec.ts` fails if a handler is never
  dispatched. The name check compiles only where `tsc` runs — CI runs it on
  every push.
- **Schemas drive the modeler.** Dropping a `*.moddle.yaml` into
  `assets/schemas/` gives you a palette entry, inspector fields and tabs,
  connection rules, templates, and round-tripping, with no code — the full
  meta-key vocabulary is in [assets/schemas/README.md](assets/schemas/README.md).
  The runner is not there yet: executing a type still needs a node module under
  `runner/nodes/<type>/`, and validation warns when a diagram uses a type no
  module handles.
- **Two UI technologies own different pixels.** React owns the palette,
  nav bar, inspector, and dialogs; bpmn-js DI providers own the context pad,
  append menu, and label editing. `packages/modeler/src/bpmn/module.ts` is the single
  registration list for everything bpmn-js-side — the right first file to read
  for canvas behavior.

- `assets/schemas/` - the moddle YAML schemas (`studyflow`, `cognitive`, `functional`, `prov`, `agentic`, `ml`, `eeg`).
- `assets/examples/` - example diagrams (see below), plus `new_diagram.bpmn`, the blank template.
- `docs/` - Quarto site (reference, guides, examples).

## Examples

Each example is a single `.studyflow.png`: a picture of the diagram with the
diagram itself embedded in it (a `studyflow` metadata chunk — see
`modeler/export/pngEmbedding`; the double extension marks the image as a
source file, the `.drawio.png` convention). The Examples gallery shows the
image and opens the file behind it, and dragging one into the modeler — or
into draw.io, or an email — works the same way.

Everything the gallery shows comes out of the diagram: its `name` is the card
title, the first sentence of its `documentation` is the blurb, and
`studyflow:tags` on the root are the shelves it sits on (editable in the
inspector's Documentation tab). The filter chips are whatever tags the
shipped examples declare.

To add one, drop a `.studyflow.yaml` into `assets/examples/` and render it —
the PNG replaces it as the shipped file, and the YAML can then be deleted:

```bash
npm run examples:render
```

Re-run it after editing an example (open the PNG, edit, export PNG over it) or
after a change to how diagrams are drawn. Pass names to redo only those:
`npm run examples:render kitchensink`. It drives a headless Chromium through
the app's own PNG export, so it needs network access for icon glyphs.

## Tests

Playwright runs everything — the Node-side unit specs (`*.unit.spec.ts`) and
the browser e2e suite. First e2e run needs `npx playwright install chromium`.

```bash
npm test             # unit + e2e
```

`npm run test:unit` is the fast lane (no dev server, ~1s); see
[CONTRIBUTING.md](CONTRIBUTING.md) for the full test strategy.

## License

MIT
