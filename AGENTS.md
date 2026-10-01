# Working in this repo

Studyflow is a BPMN-based notation for experiments. It coordinates the tools a study uses (task engines, models, robots, scripts) and is built for none of them: each joins through a skill. The canonical file is `.studyflow.yaml`, a lossless spelling of BPMN XML. An example ships as that file, never as a picture; the gallery draws its card itself.

## Commands

```bash
npm install
npm run dev                  # the modeler at http://localhost:5173/app.html, the browser runner at /run/
npm run typecheck && npm run lint && npm run test:unit   # the gate: CI and `npm run release` run exactly this
npm run test:e2e             # Playwright against its own dev server on :4173; CI skips it, so run it after UI changes
```

A spec named `*.unit.spec.ts` runs in Node, `*.spec.ts` in Chromium against the dev server, `*.webkit.spec.ts` in WebKit. Where specs live, and what each kind pins: [Tests](#tests).

## Where things are

| Path | What |
| --- | --- |
| `packages/core` | The study model: a study as plain data and its `.studyflow.yaml` spelling (`model/`), BPMN XML in and out of it and the study in a picture (`document/`, the one place moddle is used), the schema language that compiles the skills' `*.moddle.yaml` (`notation/`), what a type's attributes are (`element/`), the checks `validate` and `run` apply (`checks/`), and the walk every runtime hosts, with the plan it walks (`engine/`). No React, no I/O. |
| `packages/canvas` | The SVG canvas: a DOM-free `Study` (the document, its verbs and their tools for an AI, undo) and `Canvas` views of it. `src/index.ts` (`Study`, `Canvas`, `renderSvg` and their types) is all the modeler may import; `src/element.ts` is `<studyflow-canvas>`. |
| `packages/modeler` | The editor (React). Bus command `X` runs the `runX` export of a module `src/commandBus.ts` lists (a feature's `commands.ts`, and `diagram/save.ts`). |
| `packages/cli` | The `studyflow` CLI. `run` checks the plan, then hosts a local study itself (`packages/runtime-local`) with the protocol's digest. |
| `packages/desktop` | `studyflow edit`: the built modeler in a Chromium app window. |
| `packages/runtime-browser` | The browser runtime, served at `/run/`: it hosts the walk for one participant, a screen per step. |
| `packages/runtime-local` | The local runtime (`src/run.ts` hosts the walk: the runners' processes, the run repository and its prov record, what a re-run reuses). `CONTRACT.md` is the contract every partial runner follows, `python/` the SDK that speaks it for a runner in Python, and `WALK.md` says how the walk goes. |
| `skills/<name>` | One skill per folder: `SKILL.md`, a vocabulary (a moddle package in `*.moddle.yaml`, its palette templates included), runners (`local.py`, `browser/`), a `modeler.ts`, `examples/`, `tests/`. |

## Rules

- ESLint holds six boundaries: core imports no React and names no bpmn-js service; moddle is `core/document`'s, and everything else reads and writes a study through the study model and BPMN XML through `@core/document`; the modeler and the browser runtime never import each other; the modeler reaches the canvas through its index; the canvas's `src/study/` needs no DOM (it imports only itself and core); and the canvas's views write only through the study's verbs and `settle`, never its mutator.
- `packages/` names no skill but the required ones, whose schemas say `required: true` (`studyflow`). A skill declares what the apps need, in its schema ([skills/SCHEMAS.md](skills/SCHEMAS.md)), `modeler.ts` or `browser/vite.ts`, and the apps find it.
- Boundaries follow domain-driven design. Studyflow is one bounded context, and its runtime contracts are the published language a skill speaks to it: a partial runner for the local runtime ([packages/runtime-local/CONTRACT.md](packages/runtime-local/CONTRACT.md)), a node module for the browser runtime (`packages/runtime-browser/src/nodes/README.md`). A skill is the anti-corruption layer between Studyflow and a domain's tools: its vocabulary gives authors the domain's elements, and its runners translate between the contract and each tool's own protocol. So nothing in `packages/`, the plan or the contracts names a tool's internals.
- Each context keeps its own language. Studyflow's terms (study, run, step, runtime, runner, skill, plan) mean the same in every skill; a domain's live in its skill's vocabulary and `SKILL.md` (Behaverse's instrument and timeline in `skills/behaverse`); a tool's stay behind its protocol.
- No backward-compatibility code: an old diagram is updated in place, never aliased.
- A new short form in `.studyflow.yaml` must be reversible, and the long form must still load. `packages/core/tests/studyflow-yaml.unit.spec.ts` pins the spelling.
- A docs figure is a Studyflow diagram, never Mermaid: a `.studyflow.yaml` in `docs/assets/img/diagrams/`, and the `.studyflow.svg` beside it that `node packages/cli/dist/studyflow.mjs convert <figure>.studyflow.yaml <figure>.studyflow.svg --modeler` draws after `npm run build`.
- The canvas is its own design, not a bpmn-js copy: remove rather than add, no bpmn-js class names, colours from `INK` (`view/theme.ts`).
- Icons are Tailwind iconify classes read from the stylesheet; element glyphs are Phosphor (`iconify ph--<name>`), or another prefix `assets/css/app.css` loads when Phosphor has none that fits. Nothing fetches an icon.
- The one version is in the root `package.json`, and only `npm run release` writes it (with `Formula/studyflow.rb`).

## Tests

- A spec lives next to the code it tests, in `packages/core/tests`, `packages/canvas/tests`, `packages/desktop/tests` or `skills/<name>/tests`. `tests/` holds the modeler's specs, the CLI's, every e2e spec, and the helpers they share: `schemas.ts` (`freshModdle()`; importing it installs the shipped catalog), `utils.ts` (the shipped examples, the e2e steps) and `exporterFixture.ts`.
- Pin a behaviour once, in the cheapest spec that sees it: a unit spec before an e2e one, the canvas through `src/index.ts` before a private helper. Look for the behaviour before adding a test, and add a row to its table rather than a near-copy.
- An e2e spec is for what needs a browser, such as files, pickers and the UI wired end to end. One flow per feature.
- Every shipped example gets two checks, each from one loop: its YAML is spelled the way the modeler writes it (`packages/core/tests/studyflow-yaml.unit.spec.ts`), and the canvas draws what its DI says (`packages/canvas/tests/canvas-render.unit.spec.ts`). No spec counts the examples or snapshots a drawing.
- Core specs use core types, the studyflow and cognitive examples, or a fixture written inline. A skill's specs pin its seam: what it claims, hands on, exports or opens. Deleting a skill then deletes only its own tests.
- A bug fix comes with the one test that fails without it.

## Gotchas

- A new path alias goes in both `tsconfig.json` `paths` and `vite.shared.ts`, without a `#` prefix: Playwright hands `#…` specifiers to Node's package imports.
- `?raw` and `#assets` imports resolve only under Vite, so a module a unit spec imports must not carry one.
- A `tests/` folder inside an ESM package needs a `package.json` of `{"type": "commonjs"}`, or Playwright fails to load it.
- moddle rewrites the package descriptors it registers, so give each `BpmnModdle` its own copy (`structuredClone`): `moddleOf` keeps one per metamodel, and a spec takes one from `freshModdle()`.
- `packages/electron` is a local screenshot tool: not a workspace, not the desktop app.
