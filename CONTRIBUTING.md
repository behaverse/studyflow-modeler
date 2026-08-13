# Contributing

This project is open source and welcomes contributions.

## Setup

```bash
npm install
npm run dev          # serves /app (modeler) and /run (runner)
```

The dev server may print `[unity-build] ... not found` at boot. That is the optional Behaverse WebGL assessment bundle; almost everything works without it.

## Tests

```bash
npm test             # everything: unit + e2e (needs browsers)
npm run test:unit    # unit specs only (no browsers)
npm run lint:schemas # just the schema
npm run test:e2e     # e2e tests only
```

Initial e2e run needs browsers once: `npx playwright install chromium`.

## Quality

Lint enforces the two architecture boundaries described in the README (core/ is framework-free; modeler/ and runner/ never import each other) plus no bpmn-js service names inside core/. See the comments in `eslint.config.js`.

## Schemas

Drop a `*.moddle.yaml` into `assets/schemas/` and reload; no registration is needed. The vocabulary is documented in [`assets/schemas/README.md`](assets/schemas/README.md).
