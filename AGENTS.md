# Working in this repo

Studyflow is a BPMN-based notation for experiments. The canonical file is `.studyflow.yaml`, a lossless spelling of BPMN XML. An example diagram ships as a `.studyflow.png` with that file embedded in it.

## Commands

```bash
npm install
npm run dev                  # the modeler at http://localhost:5173/app.html, the browser runner at /run/
npm run typecheck && npm run lint && npm run test:unit   # the gate: CI and `npm run release` run exactly this
npm run test:e2e             # Playwright against its own dev server on :4173; CI skips it, so run it after UI changes
npm run examples:render      # after a canvas or file-format change, then test:unit (goldens come from the example PNGs)
```

A spec named `*.unit.spec.ts` runs in Node, `*.spec.ts` in Chromium against the dev server, `*.webkit.spec.ts` in WebKit. Specs for core and the modeler live in `tests/`; the canvas and each skill keep theirs in their own `tests/`.

## Where things are

| Path | What |
| --- | --- |
| `packages/core` | The document model: YAML and XML (`document/`), the schema language that compiles `*.moddle.yaml` (`notation/`), attribute access on one element (`element/`). No React. |
| `packages/canvas` | The SVG canvas. `src/index.ts` is all the modeler may import. |
| `packages/modeler` | The editor (React). Bus command `X` runs the `runX` export of a feature's `commands.ts`; `src/commandBus.ts` lists the features. |
| `packages/cli` | The `studyflow` CLI. `run` hands a local study to `skills/local/run.py`. |
| `packages/desktop` | `studyflow edit`: the built modeler in a Chromium app window. |
| `skills/<name>` | One skill per folder: `SKILL.md`, a vocabulary (`*.moddle.yaml`), runners (`local.py`, `browser/`), a `modeler.ts`, `examples/`, `tests/`. |
| `skills/browser` | The browser runtime, served at `/run/`. |
| `skills/local` | The local runtime (`run.py`); its `SKILL.md` is the contract every partial runner follows. |

## Rules

- ESLint holds three boundaries: core imports no React and names no bpmn-js service; the modeler and the browser runtime never import each other; the modeler reaches the canvas through its index.
- `packages/` names no skill but the core ones (`studyflow`, `prov`, `cognitive`). A skill declares what the apps need, in schema `meta.*` keys, `modeler.ts` or `browser/vite.ts`, and the apps find it.
- No backward-compatibility code: an old diagram is updated in place, never aliased.
- A new short form in `.studyflow.yaml` must be reversible, and the long form must still load. `tests/studyflow-yaml.unit.spec.ts` pins the spelling.
- The canvas is its own design, not a bpmn-js copy: remove rather than add, no bpmn-js class names, colours from `INK` (`view/theme.ts`).
- Icons are Tailwind iconify classes read from the stylesheet; element glyphs are Phosphor (`iconify ph--<name>`). Nothing fetches an icon.
- The one version is in the root `package.json`, and only `npm run release` writes it (with `Formula/studyflow.rb`).

## Gotchas

- A new path alias goes in both `tsconfig.json` `paths` and `vite.shared.ts`, without a `#` prefix: Playwright hands `#…` specifiers to Node's package imports.
- `?raw` and `#assets` imports resolve only under Vite, so a module a unit spec imports must not carry one.
- A `tests/` folder inside an ESM package needs a `package.json` of `{"type": "commonjs"}`, or Playwright fails to load it.
- moddle rewrites the package descriptors it registers, so give each `BpmnModdle` its own copy (`structuredClone`).
- `packages/electron` is a local screenshot tool: not a workspace, not the desktop app.
