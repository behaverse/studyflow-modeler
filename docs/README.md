# Docs style guide

`docs/` is the **specification of the notation** — what a studyflow *is*, what makes one well formed, what a run does, and what the shipped vocabulary declares. It is not a manual for the tools and not a tutorial. How the programs are built belongs in the package READMEs; how to contribute belongs in [`CONTRIBUTING.md`](../CONTRIBUTING.md).

It is a [Quarto](https://quarto.org/) project rooted here and rendered to `dist/docs/`.

```bash
brew install quarto   # macOS; or https://quarto.org/docs/get-started/
npm run docs          # preview with live reload
npm run docs:build    # render to dist/docs/
npm run lint:docs     # the drift guard; run it before you push
```

Navigation lives in `_quarto.yml`, as an **explicit list in the order the argument is built** — no `auto:` globs. A new page is not part of the site until it is there.

---

## 1. The nine pages

| Path | Establishes |
| --- | --- |
| `index.qmd` | what Studyflow is, and the gap it closes. The positioning statement — change with care |
| `concepts/coordination.qmd` | why the process needs a notation, and why that notation extends BPMN |
| `concepts/object.qmd` | the typed graph, its two edge kinds, and well-formedness |
| `concepts/projections.qmd` | views as predicates over that graph, and why none can contradict it |
| `concepts/execution.qmd` | the walk, seeds, the support matrix, and the provenance record |
| `concepts/extending.qmd` | schemas as the growth mechanism, and the compatibility guarantees |
| `reference/elements.qmd` | every type the shipped sets declare, and its attributes |
| `reference/file-format.qmd` | the canonical YAML, the XML projection, images that carry the study |
| `reference/glossary.qmd` | the terms, one line each |
| `assets/` | images, `.studyflow` sources, CSS, `_brand.yml` |

Something that is neither a property of the notation nor a fact about the vocabulary does not belong on this site. A worked case, a how-to, a tour of the editor: each is a page this site deliberately does not have.

---

## 2. Positioning

Studyflow is introduced as a **coordination notation**: a process standard for the cognitive sciences and adjacent fields, in the role BPMN 2.0 plays for business processes.

The grounding (Gelernter & Carriero, *Coordination Languages and their Significance*, CACM 35(2), 1992): a complete programming model has a **computation model** and a **coordination model**. Ordinary code hides coordination — ordering, dependencies, what each step hands the next — inside call graphs and shared state, and that is where drift accumulates. Studyflow externalizes it: computations stay in the tools built for them, and the notation carries the coordination that today lives in preregistrations, manuscripts, slides, and glue code.

| Write | Never write |
| --- | --- |
| a coordination notation; a process standard for research | "a diagram format" |
| the notation carries the coordination | "a visual editor", "a drawing tool" |
| extends BPMN 2.0 for research (as a *detail*) | "a BPMN extension" (as the *definition*) |

---

## 3. Terminology

Binding across every page, figure, alt text, and code comment here.

| Write | Never write | Why |
| --- | --- | --- |
| BPMN 2.0 (ISO/IEC 19510) | BPMN 2.1 | There is no BPMN 2.1 |
| **Studyflow** — the notation | studyflow (lowercase) for the notation | Proper noun |
| **a studyflow** — one object or file | "a Studyflow" | Common noun |
| `.studyflow.yaml` | `.sf`, `.studyflow.yml` | The canonical extension; bare `.studyflow` is still read |
| Behaverse Data Server, then "the data server" | "the server" | Full name once per page, short form after |

Never write "the runtime" or "the engine" for a program. **`runtime` names exactly one thing**: the attribute on the study, whose values are `browser`, `cloud`, `local`, `hpc`.

| Write | What it does |
| --- | --- |
| **the modeler** | authoring: edit, validate, import and export a studyflow |
| **the browser runner** | administers the participant-facing half |
| **the Python runner** | executes the data-facing half — steps bound to software |
| **the command line** | `studyflow convert · validate · run · render · info` |

Element names are `PascalCase` and always in code style. Before naming one, confirm it exists in `assets/schemas/*.moddle.yaml`.

| Never write | Because |
| --- | --- |
| `VideoGame`, `DataStorage`, `Snapshot` | Not element types |
| `StratifiedGateway` | Stratified allocation is a **template**: a `RandomGateway` with `stratifyBy` set |
| `requiresConsent` | The attribute is `consentFormUri` |
| `schemaRef`, `randomOrder` | Not attributes |
| `core.moddle.yaml` | The core schema file is `studyflow.moddle.yaml` |
| `OmniProcess`, `DataTrove`, `OpenBCI` | Not schemas. Core: `studyflow`, `prov`, `functional`, `cognitive`. Optional: `agentic`, `ml`, `eeg` |

---

## 4. Register and length

The reader is a **cognitive scientist or an AI researcher**, not a software engineer. Say what an element means for a study; how the tools implement it is evidence for a different reader and lives in the package READMEs. No source-tree paths in prose, and none of the implementation vocabulary the lint denies.

Length is a correctness property here, not taste: a page that overexplains has failed even where every word is true.

| Rule | Limit |
| --- | --- |
| Paragraph | ≤ 80 words |
| Distance between headings | ~200 words |
| Enumerable facts (types, attributes, options, comparisons) | a table, never prose |
| Reasoning, trade-offs, argument | prose, never a table |
| Prose per page | the budget its section carries in `tests/docs.unit.spec.ts` |

Tables, figures, and fenced code are not charged to the budget, so tabulating is free. Raising a budget is not how a long page is fixed.

The first screen must carry the page's message: a figure or a table, plus at most three sentences.

Voice: **Concepts** pages argue, and may use first-person plural. **Reference** is impersonal.

---

## 5. Mechanics

Every page carries `title` **and** `description`; the description is what search results show, so write it for a stranger.

```markdown
![Each outgoing flow of a `RandomGateway` is one arm of the allocation.](../assets/img/elements/random_gateway.svg){#fig-random fig-alt="A diamond gateway with a dice marker and three outgoing sequence flows."}
```

| Rule | Detail |
| --- | --- |
| Quarto syntax only | `![caption](path){#fig-id}` — never raw `<figure>` HTML |
| Alt text mandatory | `fig-alt="…"`. The bracket text is the *caption*, not the alt text |
| Cross-reference | `#fig-` prefix, referenced as `@fig-random` |
| No definitions in captions | a caption says what the figure shows; definitions belong in the body or in `reference/elements.qmd` |
| Source beside the render | keep the `.studyflow` source next to its exported SVG or PNG so the figure stays editable |

Callouts are reader-facing only, never a note to the next contributor — and never ship one announcing content that has not been written.

---

## 6. Nothing here is generated

Every type table, attribute name, and default value is typed by a human against `assets/schemas/*.moddle.yaml` and the tests, which keeps the prose readable and makes drift the default failure mode.

`npm run lint:docs` is the guard. It checks that every element name a page prints is one the schemas ship, that retired names stay retired, that every relative link and image resolves and stays inside `docs/`, that every page has a title and a description, that no callout advertises a gap, that no page reaches for implementation vocabulary or cites a source path, and that no page outgrows its budget. Fenced code and frontmatter are exempt from the name checks — sample YAML is illustration, not a claim about the vocabulary.

What the lint cannot see, review must: the terminology in §3, alt text on every figure, and a new page's place in the `_quarto.yml` sidebar.

When you change a schema or a default, the same commit updates the pages that quote it. A doc that lies is worse than a doc that is missing.
