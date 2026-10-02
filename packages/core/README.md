# @behaverse/studyflow-core

The studyflow model, with no UI: the study model and its files, the checks on it, the schema language, and the walk. The modeler, the canvas, the browser runner, the CLI and several skills import it as TypeScript source (`@core/*`). It imports no React and no bpmn-js; ESLint keeps it that way.

| Path | What |
| --- | --- |
| `model/` | The study model: a study as plain data (`types.ts`), read through `StudyModel` (`index.ts`) by the metamodel its schemas make (`metamodel.ts`, `packages.ts`). `yaml.ts` reads and writes the `.studyflow.yaml` file, with the reversible short forms of `spelling.ts`, writing it from the study as its file holds it (`writtenStudy`), which the BPMN XML is built from too; `patch.ts` sets one attribute in the file's tree. The rest reads and writes what a study holds: a run's `state` and its `{placeholders}` (`state.ts`), the Parameters wired into a step (`parameters.ts`), a choreography task's bands (`choreography.ts`), item definitions (`items.ts`), the root the study is (`root.ts`). |
| `document/` | The study's files beyond its YAML, and the one place moddle is used. `bpmn.ts` reads BPMN XML into a study model and writes one out (`parseStudy` takes either spelling): moddle's tree is built from the study as its file holds it (`deserialize.ts`, from `writtenStudy`) and written in the long form `readStudy` reads (`serialize.ts`), through the passes between BPMN's form and a study's (`choreography.ts`, `io-specification.ts`, `format.ts`, `state.ts`). `digest.ts` is the protocol digest a run records as its `plan`; `schema-body.ts` reads the columns a `studyflow:Schema` body declares; `png.ts` and `svg.ts` embed a study in a picture and read it back (in a PNG, an iTXt chunk keyed `application/vnd.studyflow+yaml`); `checklist.ts` is the checklist grammar; `outline.ts` is shape geometry. `index.ts` is the surface. |
| `checks/` | What `studyflow validate` checks beyond reading a file, one check per file: `soundness.ts`, `runner-paths.ts`, `data-contract.ts` and `labels.ts` of the plan, `flow-consistency.ts` and `seal.ts` of what a run left in it, over the control flow `graph.ts` reads. `index.ts` groups them; `studyflow run` applies the plan checks before it starts a study. `tests/fault-library.unit.spec.ts` is the table of faults they catch and miss. |
| `notation/` | The schema language. `moddlePackage.ts` parses a skill's `*.moddle.yaml` and lowers it to the moddle package bpmn-moddle registers; `compile.ts`, `templates.ts` and `palette.ts` compile the schemas into a `TypeCatalog` (`query.ts`), which `index.ts` holds (`setCatalog`, `getCatalog`). `loader.ts` finds every skill's `SKILL.md` and schema through Vite's `import.meta.glob`, so it runs only in a Vite build; `tests/schemas.ts` is its Node twin. |
| `element/` | What a type's attributes are (their specs, a schema type's defaults) and the type names a data association and an event definition go by. Where an attribute lives, on the element or on its schema entry, is `StudyModel`'s (`attribute`, `setAttribute`), by the table in [skills/SCHEMAS.md](../../skills/SCHEMAS.md#attribute-precedence). |
| `storage.ts`, `settings.ts` | The `localStorage` keys and settings the modeler and the browser runner share, and the diagram hand-off from one to the other. They are the only code here that touches a browser API, and they check for it first. |
| `implementation.ts`, `naming.ts`, `constants.ts` | `<scheme>://ref@version` references, qualified names, BPMN type names. |

```bash
npm run typecheck -w @behaverse/studyflow-core
npx playwright test --config playwright.unit.config.ts packages/core
```

The schemas it compiles are the skills' `*.moddle.yaml` files ([skills/SCHEMAS.md](../../skills/SCHEMAS.md)). The file format is specified in [docs/reference.qmd](../../docs/reference.qmd#the-file), and `tests/studyflow-yaml.unit.spec.ts` here pins its spelling.
