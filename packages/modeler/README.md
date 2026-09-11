# @behaverse/studyflow-modeler

The visual editor: an SVG canvas ([packages/canvas](../canvas/)) in a React shell, with the palette, inspector, templates, and connection rules generated from the skills' schemas. Served at `/app.html`; `/` is the landing page, and the examples gallery is the app's New dialog.

```bash
npm run dev                          # from the repo root: http://localhost:5173/app.html
npm run examples:render              # redraw every example PNG, after a canvas or file-format change
npm run examples:render kitchensink  # just this one; `-- --origin <url>` reuses a running modeler
```

An example is a `.studyflow.png` in `skills/<name>/examples/`: save it from the modeler, or draw one from YAML with `studyflow convert --modeler study.studyflow.yaml skills/<name>/examples/study.studyflow.png`. A schema can also ship YAML examples in its `examples:` block.
