# Contributing

This project is open source and welcomes contributions.

## Setup

```bash
npm install
npm run dev          # serves /app (modeler) and /run (runner)
```

The dev server may print `[unity-build] ... not found` at boot. That is the optional Behaverse WebGL assessment bundle; almost everything works without it.

## Where the doctrine lives

Each package's README is the contract for what that package owns: [core](packages/core/), [modeler](packages/modeler/), [browser runner](packages/runner/), [CLI and Python runners](packages/cli/). The README at the repo root has the package map and the two enforced boundaries; [`assets/schemas/README.md`](assets/schemas/README.md) is the schema-authoring reference. The `docs/` site specifies the *notation*, not the code.

## Tests

Every test lives in `tests/` at the repo root, and Playwright runs them in two lanes.

| Lane | Config | Matches | Needs a browser |
| --- | --- | --- | --- |
| unit (`npm run test:unit`) | `playwright.unit.config.ts` | `tests/**/*.unit.spec.ts` | no — no dev server, no DOM |
| e2e (`npm run test:e2e`) | the `e2e` project in `playwright.config.ts` | everything else in `tests/` | yes, plus two dev servers |

The fast lane is browserless because `core` is framework-free: a unit spec reads the shipped schemas off disk. The e2e project boots the modeler on `127.0.0.1:4173` and the browser runner on `4174`, with the modeler proxying `/run` so both sit on one origin, as the merged build is served.

```bash
npm test             # everything: unit + e2e (needs browsers)
npm run test:unit    # unit specs only, ~1s
npm run test:e2e     # e2e only; first run needs `npx playwright install chromium`
```

## Guards

| Guard | What it holds to |
| --- | --- |
| `npm run lint` | the two architecture boundaries — `core/` is framework-free (no bpmn-js service *names* either, even as `any`), and modeler and runner never import each other. See the comments in `eslint.config.js`. |
| `npm run lint:schemas` | the shipped schemas parse, compile, and stay well-formed |
| `npm run lint:docs` | every element name a page prints resolves to one a shipped schema declares; retired names stay retired; every relative link resolves and stays inside `docs/`; every page declares a title and a description, keeps the reader's register, and stays inside its section's reading budget |
| `npm run typecheck` | the command bus's name check, which is only real where `tsc` runs; CI runs it on every push |

## Schemas

Drop a `*.moddle.yaml` into `assets/schemas/` and reload; no registration is needed. That gives the new type a palette entry, inspector fields, and round-tripping — but not a screen in the browser runner, which needs a node kind ([`packages/runner/README.md`](packages/runner/README.md)). The vocabulary is documented in [`assets/schemas/README.md`](assets/schemas/README.md).

## Docs

`docs/` is the specification of the notation, written for cognitive scientists and AI researchers: what a studyflow *is*, not how the tools are built. Engineering detail belongs in the READMEs above, and `npm run lint:docs` enforces the split. [`docs/README.md`](docs/README.md) is the style guide.
