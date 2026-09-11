# @behaverse/studyflow-modeler

The visual editor: an SVG canvas ([packages/canvas](../canvas/)) in a React shell, with the palette, inspector, templates, and connection rules generated from the skills' schemas. Served at `/app.html`; the homepage and the examples gallery at `/`.

```bash
npm run dev                          # from the repo root: http://localhost:5173/app.html
npm run examples:render              # redraw every example PNG
npm run examples:render kitchensink  # just this one
```

To add an example, drop a `.studyflow.yaml` into `skills/<name>/examples/` and run `examples:render`; the PNG replaces it as the shipped file.
