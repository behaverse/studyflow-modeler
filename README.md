
# Behaverse Studyflow Modeler

Studyflow Modeler is a tool to design and run cognitive experiments using [Studyflow diagrams](https://behaverse.org/projects/studyflows). It ships two browser apps backed by a shared core library:

- **Modeler** (`app.html`) - visual editor for `.studyflow` (BPMN 2.0 XML) diagrams, with a pluggable schema palette covering cognitive, data, and domain-specific element types.
- **Runner** (`run.html`) - executes a `.studyflow` diagram end-to-end in the browser: parses the XML, validates it, and walks the flow node-by-node (consent, instructions, questionnaires, cognitive tasks, Behaverse tasks).

## Development

If you already have Node.js installed, you can start both apps in dev mode by running:

```bash
npm install
npm run dev          # serves /app.html (modeler) and /run.html (runner)
```

To run the documentation site locally:

```bash
npm run docs         # quarto preview with live reload
npm run docs:build   # render to dist/docs/
```

## Project layout

- `src/lib/core/` - shared library: moddle schema parsing, studyflow XML parsing, extension/attribute resolution.
- `src/modeler/` - modeler app (bpmn-js + React inspector/palette/contextpad).
- `src/runner/` - runner app (study traversal + per-node React renderers).
- `src/assets/schemas/` - moddle YAML schemas (`studyflow`, `cognitive`, `behaverse`, `omniprocess`, `datatrove`, `galea`).
- `src/assets/examples/` - example diagrams loaded by the modeler.
- `docs/` - Quarto site (reference, guides, examples).

## UI Tests

To run the e2e tests:

```bash
npm run test:e2e
```

## License

MIT
