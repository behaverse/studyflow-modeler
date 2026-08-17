# @behaverse/studyflow-core

The headless studyflow document model: what a studyflow *is*, with no React, no bpmn-js, and no DOM requirement. The modeler, the browser runner, and the CLI are its three consumers. (The [Python runner](../runner-py/) is a single self-contained script and reads the BPMN XML itself.)

## Contract

- It owns the **notation**: the schema catalog, the `.studyflow.yaml` ⇄ BPMN XML round trip, PNG embedding, and attribute access on one element.
- It is **framework-free** — no React, no bpmn-js or diagram-js, no imports from either app, and no bpmn-js service named even as `any`. ESLint enforces every one of those (`eslint.config.js`); a boundary crossing is a lint error, not a review comment.
- It knows nothing about pixels or participants. Anything that renders or executes belongs in a consumer.
- Each folder has **one entry module** that is its public surface: `@core/notation`, `@core/document`, `@core/element`. Nothing outside a folder imports past its `index.ts`.
- The catalog is a boot-order singleton: `loader` parses the YAML once → `loadSchemas` filters → `buildCatalog` → `setCatalog`, and `getCatalog()` throws before that rather than answering queries with silent blanks.
- Schemas are **inlined at build time** (`import.meta.glob(..., ?raw)`), so nothing resolves `assets/` at run time and a published build stays self-contained.

## Where things are

| Folder | What it holds |
| --- | --- |
| `src/notation/` | what a studyflow can contain: the `*.moddle.yaml` schemas in [`assets/schemas/`](../../assets/schemas/) parsed (`schemaFile`, `loader`, `manifest`) and compiled into the queryable type index (`compile` → `query`, `types`, `bpmn`, `palette`, `templates`) |
| `src/document/` | reading and writing studyflow files: YAML ⇄ BPMN XML (`serialize`, `deserialize`, `format`, `shorthand`, `checklist`, `png`) plus the two round-trip transforms (`choreography`, `io-specification`) |
| `src/element/` | attribute access on one element (`handle`, `attributes`, `moddle`) |
| `src/*.ts` | `constants` `naming` `implementation` `settings` `storage` — including the modeler → browser runner hand-off envelope |

## Consuming it

The package is consumed as TypeScript source. Each consumer's bundler maps two specifiers (see the root `vite.config.ts` and `tsconfig.json`):

- `@core/*` → `packages/core/src/*`
- `#assets/*` → `assets/*` (repo root)

```bash
npm run typecheck -w @behaverse/studyflow-core
```

## More

- [File format](../../docs/reference/file-format.qmd) — the format this package reads and writes.
- [The studyflow object](../../docs/concepts/object.qmd) — what the document model is a model of.
- [Architecture](../../README.md#architecture-in-short) — the two boundaries, and why framework-freedom earns a second lint rule.
- [assets/schemas/README.md](../../assets/schemas/README.md) — the schema vocabulary the catalog compiles.
