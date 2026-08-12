# @behaverse/studyflow-core

The headless studyflow document model — no React, no bpmn-js, no DOM
requirement. Everything that defines what a studyflow *is* lives here;
the modeler, the runner, and the CLI are consumers.

- `src/notation/` — what a studyflow can contain: the `*.moddle.yaml`
  schemas (loaded from the repo-level [`assets/schemas/`](../../assets/schemas/))
  parsed and compiled into the queryable type index.
- `src/document/` — reading and writing `.studyflow` files:
  YAML ↔ BPMN XML, shorthand, checklist, round-trip transforms.
- `src/element/` — attribute access on one element.
- `src/constants.ts naming.ts implementation.ts settings.ts storage.ts`

## Consumption model

The package is consumed as TypeScript source. Each consumer's bundler maps
two specifiers (see the root `vite.config.ts` and `tsconfig.json`):

- `@core/*` → `packages/core/src/*`
- `#assets/*` → `assets/*` (repo root)

Schema files are inlined at build time via `import.meta.glob(..., ?raw)` —
nothing resolves `assets/` at runtime, which is what will keep a published
build of this package self-contained.

Boundaries are enforced by the root ESLint config: no React, no bpmn-js /
diagram-js, no imports from either app.

```bash
npm run typecheck -w @behaverse/studyflow-core
```
