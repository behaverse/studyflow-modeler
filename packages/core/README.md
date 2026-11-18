# @behaverse/studyflow-core

The studyflow model, with no UI: the study model and its files, the checks on it, the schema language, and the walk. The modeler, the canvas, the browser runner, the CLI and several skills import it as TypeScript source (`@core/*`). It imports no React and no bpmn-js; ESLint keeps it that way.

| Path | What |
| --- | --- |
| `model/` | The study model: a study as plain data (`types.ts`), read through `StudyModel` (`index.ts`) by the metamodel its schemas make (`metamodel.ts`, `packages.ts`). `yaml.ts` reads and writes the `.studyflow.yaml` file, with the reversible short forms of `spelling.ts`, writing it from the study as its file holds it (`writtenStudy`), which the BPMN XML is built from too; `patch.ts` sets one attribute in the file's tree. The rest reads and writes what a study holds: a run's `state` and its `{placeholders}` (`state.ts`), the Parameters wired into a step (`parameters.ts`), a choreography task's bands (`choreography.ts`), item definitions (`items.ts`), the root the study is (`root.ts`), the images pasted on its canvas and the study without them (`pastedImages.ts`). |
| `document/` | The study's files beyond its YAML, and the one place moddle is used. `bpmn.ts` reads BPMN XML into a study model and writes one out (`parseStudy` takes either spelling): moddle's tree is built from the study as its file holds it (`deserialize.ts`, from `writtenStudy`) and written in the long form `readStudy` reads (`serialize.ts`), through the passes between BPMN's form and a study's (`choreography.ts`, `io-specification.ts`, `format.ts`, `state.ts`). `digest.ts` is the protocol digest a run records as its `plan`; `schema-body.ts` reads the columns a `studyflow:Schema` body declares; `png.ts` and `svg.ts` embed a study in a picture and read it back (in a PNG, an iTXt chunk keyed `application/vnd.studyflow+yaml`, and a private `stIm` chunk for each image pasted on its canvas); `checklist.ts` is the checklist grammar; `outline.ts` is shape geometry. `index.ts` is the surface. |
| `checks/` | What `studyflow validate` checks beyond reading a file, one check per file: `soundness.ts`, `runner-paths.ts`, `data-contract.ts` and `labels.ts` of the plan, `flow-consistency.ts` and `seal.ts` of what a run left in it, over the control flow `graph.ts` reads; `materials.ts` holds what a study registers by its content against its digest, the bytes read by the CLI. `index.ts` groups them; `studyflow run` applies the plan checks before it starts a study. `tests/fault-library.unit.spec.ts` is the table of faults they catch and miss. |
| `notation/` | The schema language. `moddlePackage.ts` parses a skill's `*.moddle.yaml` and lowers it to the moddle package bpmn-moddle registers; `compile.ts`, `templates.ts` and `palette.ts` compile the schemas into a `TypeCatalog` (`query.ts`), which `index.ts` holds (`setCatalog`, `getCatalog`). `loader.ts` finds every skill's `SKILL.md` and schema through Vite's `import.meta.glob`, so it runs only in a Vite build; `tests/schemas.ts` at the repo root is its Node twin. |
| `element/` | What a type's attributes are (their specs, a schema type's defaults) and the type names a data association and an event definition go by. Where an attribute lives, on the element or on its schema entry, is `StudyModel`'s (`attribute`, `setAttribute`), by the table in [skills/SCHEMAS.md](../../skills/SCHEMAS.md#attribute-precedence). |
| `storage.ts` | The `localStorage` keys the modeler and the browser runner share, and the diagram hand-off from one to the other. It is the only code here that touches a browser API, and it checks for it first. |
| `implementation.ts`, `naming.ts`, `constants.ts` | `<scheme>://ref@version` references, qualified names, BPMN type names. |

```bash
npm run typecheck -w @behaverse/studyflow-core
npx playwright test --config playwright.unit.config.ts packages/core
```

The schemas it compiles are the skills' `*.moddle.yaml` files ([skills/SCHEMAS.md](../../skills/SCHEMAS.md)). The file format is specified in [docs/format.qmd](../../docs/format.qmd), and `tests/studyflow-yaml.unit.spec.ts` here pins its spelling.

## What `validate` checks

`checks/` holds one check per file, and `studyflow validate` applies them all without running the study. An entry marked ⚠ is a warning, which fails only with `--strict`.

| About | Checks |
|:--|:--|
| the file | it parses; the sets it uses loaded; no unknown name; every id names one element |
| edges | a sequence flow joins two steps of its own process or sub-process; a data edge joins a data element to its step; a step reaches a property only inside its scope, and a data store only through a reference |
| data stores | no two share a name; none starts with `_`; no property hides one ⚠ |
| paths | a process or sub-process with flows has a start and an end event, and every step lies on a path between them |
| loops | a loop has a `while`, a `maximum`, or an interrupting boundary event to end it |
| constructs a run does not read | no complex gateway that splits; no conditions on a parallel gateway's flows; no signal, escalation, compensation, link or cancel event |
| event-based gateways | each branch starts at an event a message, a timer or a condition makes happen |
| call activities | the process called is in the study ⚠, and is not one the call sits in |
| boundary events | an error boundary event is not marked non-interrupting ⚠ |
| parallel paths | no two steps on paths that run at once write the same value ⚠ |
| expressions | each is FEEL the runtimes run |
| exclusive gateways | conditions on one number do not overlap ⚠, and leave no value without a flow when there is no default |
| attributes | each value has its schema's type: an enumeration's value, a whole number, a number, true or false |
| entry and exit | `consentFormUri` is an address a page can fetch; an end event that hands a code has one |
| implementations | each names a scheme a loaded skill runs ⚠ |
| labels | none writes as a number a value the file declares and its conditions read ⚠ |
| registered materials | each still holds the content its `digest` names |
| columns | each column a step reads from a schema-bound dataset is in that schema |
| BPMN | the XML is valid against the OMG's schema (with `xmllint`; ⚠ when the machine has none) |

It then **explores every way the study can go**, taking each decision as a free choice, and warns about a pool left waiting for a message no one sends, a parallel join one of whose tokens can never come, and a message nothing takes. This is soundness, in the sense of workflow nets, for the control flow. A condition that never holds is still the data's to show.

For a study that has **run**, it also checks that:

- the counts balance: every node was reached as often as its flows brought tokens in and took them out;
- the protocol is still the one the last run recorded, by its digest (`plan`);
- the state in the file matches the record, when `events.jsonl` sits beside it.
