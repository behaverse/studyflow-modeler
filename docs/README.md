# Studyflow Modeler Docs

This documentation site is built with [Quarto](https://quarto.org/).

## Site structure

- `index.qmd` -- landing page.
- `faq.qmd` -- quick answers.
- `get-started.qmd` -- single read-along tutorial.
- `guides/` -- task-oriented how-tos (modeler app, save/share, counterbalancing, publishing, preprocessing, schemas).
- `reference/` -- facts and concepts (why-studyflow, vs-BPMN, elements, data, views, spec, glossary).
- `examples/` -- domain-specific worked examples, tagged Experiments / Analysis.
- `develop/` -- contributor docs (moddle schemas, dev setup).
- `roadmap.qmd` -- forward-looking only; changelog lives in GitHub Releases.
- `assets/` -- images, screenshots, CSS, brand.

Sidebar order and labels are controlled by `_quarto.yml`.

## Prerequisites

Install Quarto CLI: <https://quarto.org/docs/get-started/>

```bash
brew install quarto   # macOS
```

## Development

```bash
npm run docs          # preview with live reload
```

## Build

```bash
npm run docs:build    # renders to dist/docs/
```

## Authoring conventions

- Every page has `title` and `description` frontmatter. The description appears in the gallery and in search.
- Example pages have a `categories:` list with one or more of `Experiments`, `Analysis`.
- Diagrams: prefer SVG over PNG. Source `.studyflow` files live next to the rendered SVG so the source is recoverable.
- Cross-link element mentions back to `reference/elements.qmd` and pipeline operations back to `reference/data.qmd`.
- Contributor-facing content lives in `develop/`, not `reference/`.
