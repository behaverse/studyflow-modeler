# @behaverse/studyflow-core

The studyflow model, with no UI: the file format, the schema language, and attribute access on one element. The modeler, the canvas, the browser runner, the CLI and several skills import it as TypeScript source (`@core/*`). It imports no React and no bpmn-js; ESLint keeps it that way.

| Path | What |
| --- | --- |
| `document/` | The file. `deserialize.ts` turns `.studyflow.yaml` into moddle definitions and `serialize.ts` turns them back; both use `shorthand.ts`, the reversible short forms. `index.ts` is the surface: `studyflowToXml`, `xmlToStudyflow`, and `fromWireXml`, which every BPMN the apps read goes through. `choreography.ts` and `io-specification.ts` are the passes between the saved form and the one the canvas edits; `state.ts` is a run's `state` tree and its `{placeholders}`; `png.ts` embeds a studyflow in a PNG and reads it back; `checklist.ts` is the checklist grammar. |
| `notation/` | The schema language. `schemaFile.ts` parses a `*.moddle.yaml` and lowers it to moddle packages; `compile.ts`, `templates.ts` and `palette.ts` compile the schemas into a `TypeCatalog` (`query.ts`), which `index.ts` holds (`setCatalog`, `getCatalog`). `loader.ts` finds every skill's `SKILL.md` and schema through Vite's `import.meta.glob`, so it runs only in a Vite build; `tests/schemas.ts` is its Node twin. |
| `element/` | Reading and writing one attribute: `StudyflowElement` (`handle.ts`) decides whether it lives on the business object or on its extension wrapper, by the table in [skills/SCHEMAS.md](../../skills/SCHEMAS.md#attribute-precedence), and writes through an `AttributeUpdater` the caller passes (the canvas, in the modeler). |
| `storage.ts`, `settings.ts` | The `localStorage` keys and settings the modeler and the browser runner share, and the diagram hand-off from one to the other. They are the only code here that touches a browser API, and they check for it first. |
| `implementation.ts`, `naming.ts`, `constants.ts` | `<scheme>://ref@version` references, qualified names, BPMN type names. |

```bash
npm run typecheck -w @behaverse/studyflow-core
npx playwright test --config playwright.unit.config.ts tests/studyflow-yaml tests/element tests/catalog
```

The schemas it compiles are the skills' `*.moddle.yaml` files ([skills/SCHEMAS.md](../../skills/SCHEMAS.md)). The file format is specified in [docs/reference.qmd](../../docs/reference.qmd#the-file), and `tests/studyflow-yaml.unit.spec.ts` pins its spelling.
