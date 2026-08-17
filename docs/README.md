# Docs style guide

The documentation site is a [Quarto](https://quarto.org/) project rooted at `docs/` and rendered to `dist/docs/`. This file is the contract every page is held to. It is short on purpose — read it before you write.

```bash
brew install quarto   # macOS; or https://quarto.org/docs/get-started/
npm run docs          # preview with live reload
npm run docs:build    # render to dist/docs/
```

Navigation lives in `docs/_quarto.yml`. Its sidebar is an **explicit, pedagogically ordered list** — no `auto:` globs. A new page is not part of the site until you add it there, in the place a reader would meet it, not in alphabetical order.

---

## 1. Positioning

Wherever a page introduces Studyflow, it introduces a **coordination notation**: a process standard for the cognitive sciences and adjacent fields, in the role BPMN 2.0 plays for business processes.

The grounding (Gelernter & Carriero, *Coordination Languages and their Significance*, CACM 35(2), 1992): a complete programming model has two parts, a **computation model** and a **coordination model**. Ordinary code hides coordination — ordering, dependencies, what each step hands the next — inside call graphs and shared state, and that is where drift accumulates.

Studyflow externalizes it. Computations stay in the tools built for them (jsPsych, PsychoPy, Python, Unity, an LLM call); the notation carries the coordination that today lives in preregistrations, manuscripts, slides, and glue code.

| Write | Never write |
| --- | --- |
| a coordination notation; a process standard for research | "a diagram format" |
| the notation carries the coordination | "a visual editor", "a drawing tool" |
| extends BPMN 2.0 for research (as a *detail*) | "a BPMN extension" (as the *definition*) |

`docs/index.qmd` carries the approved wording. Match its voice rather than reinventing it.

---

## 2. Terminology

Binding across every page, figure, alt text, and code comment in `docs/`.

### 2.1 Names

| Write | Never write | Why |
| --- | --- | --- |
| BPMN 2.0 (ISO/IEC 19510) | BPMN 2.1 | There is no BPMN 2.1 |
| **Studyflow** — the notation | studyflow (lowercase) for the notation | Proper noun |
| **a studyflow** — one diagram or file | "a Studyflow" | Common noun |
| `.studyflow.yaml` | `.sf`, `.studyflow.yml` | Canonical export extension (`packages/modeler/src/export/formats.ts`); bare `.studyflow` is still read |
| `.studyflow.png` for gallery examples | "an image of the studyflow", "a screenshot of the diagram" | The PNG embeds its own source, so the image *is* the file. (UI screenshots are a different thing, and keep the name) |
| Behaverse Data Server, then "the data server" | "the server", "Behaverse server" | Full name once per page, short form after |

### 2.2 The four executors — name them distinctly

Never write "the runtime" or "the engine" for a program. **`runtime` names exactly one thing**: the `studyflow:runtime` attribute on `Study`, whose values are `browser`, `cloud`, `local`, `hpc` (`assets/schemas/studyflow.moddle.yaml`).

| Write | Lives in | What it does |
| --- | --- | --- |
| **the modeler** | `packages/modeler` | Authoring: edit, validate, import/export a studyflow |
| **the browser runner** | `packages/runner` | Administers the participant-facing half to a person or a bot |
| **the Python runner** | `packages/runner-py` | Executes the analysis half — steps bound to software |
| **the CLI** | `packages/cli` | `studyflow convert · validate · run · render · info` |

### 2.3 Element names

Element names are `PascalCase` and always in code style. Before you name one, confirm it exists in `assets/schemas/*.moddle.yaml`.

Real, and verified in the schemas:

`Study` · `Actor` · `CognitiveTask` · `Questionnaire` · `Instruction` · `Rest` · `BehaverseTask` · `RandomGateway` · `EligibilityGateway` · `Dataset` · `Schema` · `Table` · `Timeseries` · `EventMarker` · `DataCatalog` · `Parameters` · `functional:Transform` / `Map` / `Reduce` / `Filter` · `agentic:*` · `prov:Activity`

| Never write | Because |
| --- | --- |
| `VideoGame`, `DataStorage`, `Snapshot`, `Array` | Not element types |
| `StratifiedGateway` | Stratified allocation is a **template**: a `RandomGateway` with `stratifyBy` set |
| `requiresConsent` | The attribute is `consentFormUri` |
| `schemaRef`, `randomOrder` | Not attributes |
| `core.moddle.yaml` | The core schema file is `studyflow.moddle.yaml` |
| `OmniProcess`, `DataTrove`, `OpenBCI` | Not schemas. Core: `studyflow`, `prov`, `functional`, `cognitive`. Optional: `agentic`, `ml`, `eeg` |

---

## 3. Page rules

### 3.1 Visuals first — the 30-second rule

The first screen must convey the page's message in 30 seconds: **a figure or a table, plus at most three sentences.** Prose explains only what a visual cannot. If a page opens with two paragraphs before the reader sees anything, it fails.

### 3.2 Length

| Rule | Limit |
| --- | --- |
| Paragraph | ≤ 80 words |
| Distance between headings | ~200 words |
| Enumerable facts (elements, attributes, options, comparisons) | A table, never prose |
| Reasoning, trade-offs, argument | Prose, never a table |
| Aphorisms | At most **one** per page, as the closing line of an explanation — never *instead of* one |

Voice: **Concepts** pages may argue in first-person plural. **Guides** are second person imperative ("Open the modeler, then…"). **Reference** is impersonal.

### 3.3 Frontmatter

Every page carries `title` **and** `description`. The description is what search results and the Examples gallery show, so write it for a stranger.

```yaml
---
title: Attach a schema to a dataset
description: Declare column types, units, and constraints so downstream tasks can validate
---
```

Example pages additionally carry `subtitle` and a `categories:` list drawn from `Experiments`, `Analysis`.

### 3.4 Figures

```markdown
![Each outgoing flow of a `RandomGateway` is one arm of the allocation.](../assets/img/elements/random_gateway.svg){#fig-random fig-alt="A diamond gateway with a shuffle marker and three outgoing sequence flows."}
```

| Rule | Detail |
| --- | --- |
| Quarto syntax only | `![caption](path){#fig-id}` — never raw `<figure>` HTML |
| Alt text mandatory | `fig-alt="…"`. The bracket text is the *caption*, not the alt text |
| Cross-reference | `#fig-` prefix, referenced as `@fig-random` |
| No definitions in captions | A caption says what the figure shows; definitions belong in the body or in `reference/elements.qmd` |
| Source beside the render | Keep the `.studyflow.yaml` (or `.studyflow`) next to its exported SVG/PNG so the figure stays editable |

### 3.5 Callouts

Callouts are **reader-facing only** — never a note to the next contributor. Use `note`, `tip`, `warning`, or `important`. `.callout-info` is not a Quarto callout type, so it silently degrades to a plain unstyled div.

**Never ship a TODO callout.** If the artifact a section needs is missing, leave the section out and report it, rather than shipping `title="Diagram (TODO)"` to readers.

---

## 4. The difficulty ladder

Every page sits on one rung. The sidebar order within a section is the ladder order.

| Rung | Reader | Rule |
| --- | --- | --- |
| **L1** | Has never seen Studyflow or BPMN | No unglossed BPMN term. Gloss on first use, or link `reference/bpmn.qmd` |
| **L2** | Has read the L1 path | Opens with an `Assumes:` line linking its prerequisites |
| **L3** | Models studyflows regularly; reads schemas | May assume the whole vocabulary; still opens with `Assumes:` |

| Section | Directory | Rung |
| --- | --- | --- |
| Start | `index.qmd`, `start/` | L1 |
| Guides | `guides/` | L1 → L3, in sidebar order |
| Examples | `examples/` | L1–L2 |
| Concepts | `concepts/` | L2 |
| Reference | `reference/` | L2–L3 |
| Develop | `develop/` | L3 |

### 4.1 The `Assumes:` line

The first line of the body on any L2 or L3 page, before the opening visual:

```markdown
Assumes: [Get started](../start/quickstart.qmd) and [Reading studyflows](../start/reading-studyflows.qmd).
```

### 4.2 Modeler | YAML tabsets

When a task can be done either in the modeler or by editing the file, show both — **modeler tab first**, because that is how most readers will do it.

````markdown
::: {.panel-tabset}

## Modeler

1. Select the **Flanker** task.
2. In the properties panel, set **Instrument** to `jspsych`.

## YAML

```yaml
Flanker:
  type: bpmn:Task
  name: Flanker
  extensionElements:
    - type: cognitive:CognitiveTask
      instrument: jspsych
```

:::
````

Never show only the YAML for something the modeler can do, and never show only the modeler for something a reviewer needs to read in the file.

---

## 5. Docs mirror the code by hand

**No page on this site is generated.** Every element table, attribute name, default value, and CLI flag is typed by a human against `assets/schemas/*.moddle.yaml`, `packages/`, and the tests. That keeps the prose readable — and it means drift is the default failure mode, not an accident.

The docs lint is the drift guard. Run it before you push:

```bash
npm run lint:docs     # tests/docs.unit.spec.ts, over every .qmd in docs/
```

| Check | Fails when | Enforced by |
| --- | --- | --- |
| Element names | A `PascalCase` type a page prints is not one the schemas ship | lint |
| Retired names | A page revives a name from §2.3 ("Never write") | lint |
| Links and images | A relative link or image path does not resolve to a file | lint |
| Frontmatter | A page is missing `title` or `description` | lint |
| Unwritten content | A callout says `TODO`, `TBD`, `FIXME`, `WIP`, "coming soon", "under construction" | lint |
| Terminology | The §2 rules the lint cannot see: executor names, BPMN version, file extensions | review |
| Figures | A figure has no `fig-alt`, or a caption carries a definition | review |
| Ladder | An L2/L3 page has no `Assumes:` line | review |
| Navigation | A new page is not in the `_quarto.yml` sidebar, or an `auto:` glob has crept back in | review |

Fenced code and frontmatter are exempt from the name checks — sample YAML is illustration, not a claim about the vocabulary.

When you change a schema, a package name, or a CLI flag, the same commit updates the pages that quote it. A doc that lies is worse than a doc that is missing.

---

## 6. Where things live

| Path | Holds |
| --- | --- |
| `docs/_quarto.yml` | Navbar, sidebar, theme. The single source of navigation order |
| `docs/index.qmd` | The positioning statement. Change with care |
| `docs/start/` | The L1 on-ramp |
| `docs/guides/` | Task-oriented how-tos, one task per page |
| `docs/examples/` | Worked examples; gallery cards come from `title`, `subtitle`, `categories` |
| `docs/concepts/` | Why and how it works — argument, not instructions |
| `docs/reference/` | Facts: elements, data, file format, CLI, spec, glossary |
| `docs/develop/` | Contributor-facing: architecture, schema authoring, runner nodes |
| `docs/roadmap.qmd` | Forward-looking only; released changes go in GitHub Releases |
| `docs/assets/` | Images, `.studyflow` sources, CSS, `_brand.yml` |
