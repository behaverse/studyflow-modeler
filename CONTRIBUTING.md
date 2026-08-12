# Contributing

## Setup

Node **≥ 20.19** (Vite 7's floor; `.nvmrc` pins 22, CI uses the same file):

```bash
npm install
npm run dev          # serves /app.html (modeler) and /run.html (runner)
```

The dev server may print `[unity-build] … not found` at boot — that is the
optional Behaverse WebGL assessment bundle (see `vite.config.ts`); everything
else works without it.

## Tests

Playwright is the **only** test runner — including for the ~35 `*.unit.spec.ts`
files, which are plain Node-side unit tests that import `src/` directly. One
runner keeps one dependency, one config language, and one report; the cost is
that the default config boots the Vite dev server for the e2e project.
`playwright.unit.config.ts` is the unit lane and skips it:

```bash
npm test             # everything: unit + e2e (starts the dev server; needs browsers)
npm run test:unit    # unit specs only — no dev server, fully parallel, ~1s
npm run lint:schemas # just the schema lint + catalog cross-validation suites
npm run test:e2e     # e2e project only
```

First e2e run needs browsers once: `npx playwright install chromium`.

The suite's conventions worth knowing:

- **The examples are the golden files.** Every shipped example round-trips as a
  fixed point (YAML → XML → YAML) in `studyflow-yaml.unit.spec.ts`, and the
  PNGs regenerate through the app's own export (`npm run examples:render`).
- **Conventions are executable.** `commands.unit.spec.ts` fails if a command
  handler is never dispatched; `schemas.unit.spec.ts` lints the schema YAML;
  `catalog.unit.spec.ts` cross-validates the compiled catalog against
  bpmn-moddle itself.
- Browser-side tests reach app internals through `window.__studyflowTest`
  (`src/modeler/testHooks.ts`, dev-only) — never through dev-server URL
  imports, which the compiler cannot check.

## Quality gates

CI (`.github/workflows/test.yml`) runs, in order: `typecheck`, `lint`, `build`,
`test:unit`, then e2e. Lint enforces the two architecture boundaries described
in the README (core/ is framework-free; modeler/ and runner/ never import each
other) plus a ban on bpmn-js service names inside core/ — see the comments in
`eslint.config.js`. Deploys run only after Test succeeds on `main`.

Decisions we made once so nobody relitigates them in review:

- `strict` is on; `noUncheckedIndexedAccess` is **deliberately off** for now —
  the core walks moddle descriptor records everywhere and the annotation cost
  outweighs the value mid-refactor. Revisit when the moddle boundary is typed.
- `no-explicit-any` is a warning, not an error: the moddle/bpmn-js boundary is
  genuinely untyped. New code should prefer `ModdleElement`
  (`core/element/moddle.ts`) over `any` for moddle objects.
- User-facing failure has one house rule (`src/modeler/app/noticeStore.ts`): inline in
  the open dialog when the failure is dialog-scoped, a `notify()` notice for
  everything else, never `alert()`, never console-only.

## Schema authoring

Drop a `*.moddle.yaml` into `assets/schemas/` and reload — the loader
auto-globs the directory; no registration. The full meta-key vocabulary is
documented in [`assets/schemas/README.md`](assets/schemas/README.md).
Iterating:

- A file that fails to parse is quarantined (app still boots) and listed in
  Settings → Extensions with its parse error.
- Semantic problems (unknown `bpmn:` types, bad enum defaults, unknown editor
  names, duplicate prefixes, ambiguous refs) surface as compile diagnostics in
  the console and as ⚠ notes on the schema's row in Settings → Extensions.
- `npm run lint:schemas` runs the full CI-grade schema suite in about a second.

## Where things live

The README's "Project layout" section is the map. Two entry points worth
knowing before your first change: `src/modeler/bpmn/module.ts` is the single
registration list for everything bpmn-js-side (canvas renderers, context pad,
behaviors), and `packages/core/src/notation/index.ts` documents the schema→catalog boot
sequence at the top of the file.
