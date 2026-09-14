# Working in this repo

Studyflow is a BPMN-based notation for experiments. The canonical file is `.studyflow.yaml`, a lossless spelling of BPMN XML. An example ships as that file, never as a picture; the gallery draws its card itself.

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
| `packages/core` | The document model: YAML and XML (`document/`), the schema language that compiles the skills' `*.moddle.yaml` (`notation/`), attribute access on one element (`element/`). No React. |
| `packages/canvas` | The SVG canvas. `src/index.ts` is all the modeler may import. |
| `packages/modeler` | The editor (React). Bus command `X` runs the `runX` export of a feature's `commands.ts`; `src/commandBus.ts` lists the features. |
| `packages/cli` | The `studyflow` CLI. `run` hands a local study to `skills/local/run.py`. |
| `packages/desktop` | `studyflow edit`: the built modeler in a Chromium app window. |
| `skills/<name>` | One skill per folder: `SKILL.md`, a vocabulary (a moddle package in `*.moddle.yaml`, its palette templates included), runners (`local.py`, `browser/`), a `modeler.ts`, `examples/`, `tests/`. |
| `skills/browser` | The browser runtime, served at `/run/`. |
| `skills/local` | The local runtime (`run.py`); its `SKILL.md` is the contract every partial runner follows. |

## Rules

- ESLint holds three boundaries: core imports no React and names no bpmn-js service; the modeler and the browser runtime never import each other; the modeler reaches the canvas through its index.
- `packages/` names no skill but the required ones, whose schemas say `required: true` (`studyflow`, `prov`, `cognitive`, `local`). A skill declares what the apps need, in its schema ([skills/SCHEMAS.md](skills/SCHEMAS.md)), `modeler.ts` or `browser/vite.ts`, and the apps find it.
- No backward-compatibility code: an old diagram is updated in place, never aliased.
- A new short form in `.studyflow.yaml` must be reversible, and the long form must still load. `packages/core/tests/studyflow-yaml.unit.spec.ts` pins the spelling.
- The canvas is its own design, not a bpmn-js copy: remove rather than add, no bpmn-js class names, colours from `INK` (`view/theme.ts`).
- Icons are Tailwind iconify classes read from the stylesheet; element glyphs are Phosphor (`iconify ph--<name>`), or another prefix `assets/css/app.css` loads when Phosphor has none that fits. Nothing fetches an icon.
- The one version is in the root `package.json`, and only `npm run release` writes it (with `Formula/studyflow.rb`).

## Tests

- A spec lives next to the code it tests, in `packages/core/tests`, `packages/canvas/tests`, `packages/desktop/tests` or `skills/<name>/tests`. `tests/` holds the modeler's specs, every e2e spec, and the helpers they share: `schemas.ts` (`freshModdle()`; importing it installs the shipped catalog), `utils.ts` (the shipped examples, the e2e steps) and `exporterFixture.ts`.
- Pin a behaviour once, in the cheapest spec that sees it: a unit spec before an e2e one, the canvas through `src/index.ts` before a private helper. Look for the behaviour before adding a test, and add a row to its table rather than a near-copy.
- An e2e spec is for what needs a browser, such as files, pickers and the UI wired end to end. One flow per feature.
- Every shipped example gets two checks, each from one loop: its YAML is spelled the way the modeler writes it (`packages/core/tests/studyflow-yaml.unit.spec.ts`), and the canvas draws what its DI says (`packages/canvas/tests/canvas-render.unit.spec.ts`). No spec counts the examples or snapshots a drawing.
- Core specs use core types, the studyflow and cognitive examples, or a fixture written inline. A skill's specs pin its seam: what it claims, hands on, exports or opens. Deleting a skill then deletes only its own tests.
- A bug fix comes with the one test that fails without it.

## Gotchas

- A new path alias goes in both `tsconfig.json` `paths` and `vite.shared.ts`, without a `#` prefix: Playwright hands `#…` specifiers to Node's package imports.
- `?raw` and `#assets` imports resolve only under Vite, so a module a unit spec imports must not carry one.
- A `tests/` folder inside an ESM package needs a `package.json` of `{"type": "commonjs"}`, or Playwright fails to load it.
- moddle rewrites the package descriptors it registers, so give each `BpmnModdle` its own copy (`structuredClone`); a spec takes one from `freshModdle()`.
- `packages/electron` is a local screenshot tool: not a workspace, not the desktop app.
