# Docs style guide

`docs/` is the argument for Studyflow, the reference of the notation, and one map of the programs that read it. It is not a tutorial, and it duplicates no engineering detail: how each program is built stays in its package README; how to contribute belongs in [`CONTRIBUTING.md`](../CONTRIBUTING.md).

It is a [Quarto](https://quarto.org/) project rooted here and rendered to `dist/docs/`.

```bash
brew install quarto   # macOS; or https://quarto.org/docs/get-started/
npm run docs          # preview with live reload
npm run docs:build    # render to dist/docs/
npm run lint:docs     # the drift guard; run it before you push
```

Navigation is a three-item sidebar in `_quarto.yml`, in the order the argument is built.

---

## 1. The three pages

| Path | Establishes |
| --- | --- |
| `index.qmd` | what Studyflow is, the gap it closes, and why it extends BPMN. The positioning statement — change with care |
| `developers.qmd` | the map of the programs: the packages, the two executors, the run records, and how the vocabulary grows. The one page written for engineers |
| `reference.qmd` | the object and its well-formedness, every type the shipped sets declare, and the files a studyflow is stored in |
| `assets/` | images, `.studyflow` sources, CSS, `_brand.yml` |

Three pages: the argument, the toolchain, the notation. Something that is none of those does not belong here — a worked case, a how-to, a tour of the editor, a glossary restating definitions given elsewhere: each is a page this site deliberately does not have. A **fourth page is a decision, not an increment**; prefer a section on an existing one. `developers.qmd` is a *map*, not a manual: it links each package README rather than restating it.

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

*Study* and *experiment* are both correct; mix them. Prefer **experiment** (and *eval*, *harness*, *experiment graph*) where the sentence should also speak to AI researchers, and **study** where it is human-subjects specific — ethics, protocol, recruitment — or names the `Study` element type.

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

The reader of `index.qmd` and `reference.qmd` is a **cognitive scientist or an AI researcher**, not a software engineer. Say what an element means for a study; how the tools implement it is evidence for a different reader and lives in the package READMEs — keep source-tree paths and implementation vocabulary out of those two pages. `developers.qmd` is the one page written for engineers, and even there the READMEs stay the source of depth.

Length is a correctness property here, not taste: a page that overexplains has failed even where every word is true. These are editorial rules, enforced in review rather than by the lint:

| Rule | Limit |
| --- | --- |
| Paragraph | ≤ 80 words |
| Distance between headings | ~200 words |
| Enumerable facts (types, attributes, options, comparisons) | a table, never prose |
| Reasoning, trade-offs, argument | prose, never a table |

The first screen must carry the page's message: a figure or a table, plus at most three sentences.

Voice: plain and direct. Say it the way you would to a colleague; the overview may address the reader as *you*, and **Reference** stays impersonal. No manifesto prose, no formalism for its own sake — if a sentence sounds impressive but a reader cannot act on it, cut it.

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
| No definitions in captions | a caption says what the figure shows; definitions belong in the body or in `reference.qmd` |
| Source beside the render | keep the `.studyflow` source next to its exported SVG or PNG so the figure stays editable |

Callouts are reader-facing only, never a note to the next contributor — and never ship one announcing content that has not been written.

---

## 6. Nothing here is generated

Every type table, attribute name, and default value is typed by a human against `assets/schemas/*.moddle.yaml` and the tests, which keeps the prose readable and makes drift the default failure mode.

`npm run lint:docs` is the guard, and it is deliberately small — adding a page, renaming one, or writing more prose never breaks it. It checks three things: every element name a page prints resolves to a shipped schema, every relative link and image lands on a file inside `docs/`, and every page carries a title and a description. Fenced code and frontmatter are exempt from the name check — sample YAML is illustration, not a claim about the vocabulary.

What the lint cannot see, review must: the terminology in §3, the register and length rules in §4, alt text on every figure, and a new page's place in the `_quarto.yml` sidebar.

When you change a schema or a default, the same commit updates the pages that quote it. A doc that lies is worse than a doc that is missing.
